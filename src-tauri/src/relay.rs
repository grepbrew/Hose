// The local relay for coding tools (Claude Code, Codex): one fixed address on this Mac, routed by each request's
// `model` to that config's current pod. A pod's address changes every Turn on (Turn off deletes it), so the tools are
// set up once against this. The tools send the relay's own token; the pod key is added here and never leaves Hose.
// Errors come back as 400s in the API's own shape: both tools show a 400's message at once and don't retry it
// (checked against Claude Code 2.1.325 and Codex 0.167.0, 2026-11-14), so "starting, try again" reads cleanly.
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::Response;
use axum::Router;
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const PORT: u16 = 41180;

/** One chat config as the relay sees it; sent by the app (relayRoutes in cost.ts) whenever configs or pods change. */
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Route {
    pub name: String,  // what the tools call it: qwen3-coder-30b
    pub hf_id: String, // what the pod serves: Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8
    pub pod_id: Option<String>,
    pub ready: bool,
    pub can_start: bool, // "Coding tools can turn this on"
    pub key: String,     // the config's key, for the app's Turn on
    pub price: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Table {
    pub token: String,
    pub pod_key: String,
    pub routes: Vec<Route>,
}

type Hook = Box<dyn Fn(&str) + Send + Sync>;

pub struct Relay {
    table: Mutex<Table>,
    last: Mutex<Option<String>>,        // the last name asked for, for Claude Code's background calls
    healthy: Mutex<HashSet<String>>,    // pods whose /health answered while the app hadn't seen them ready yet
    asked: Mutex<HashSet<String>>,      // configs this relay asked to start since the last table: one Turn on each
    waiting: Mutex<HashSet<String>>,    // configs started by the relay, not ready yet: a notice when they are
    upstream: Box<dyn Fn(&str) -> String + Send + Sync>, // pod id -> its base URL
    on_start: Hook,                     // config key -> the app turns it on
    on_ready: Hook,                     // name -> "… is ready" notice
    http: reqwest::Client,
    pub status: Mutex<String>,          // why the relay isn't listening, "" while it is
}

impl Relay {
    pub fn new(upstream: Box<dyn Fn(&str) -> String + Send + Sync>, on_start: Hook, on_ready: Hook) -> Self {
        Relay {
            table: Mutex::default(),
            last: Mutex::default(),
            healthy: Mutex::default(),
            asked: Mutex::default(),
            waiting: Mutex::default(),
            upstream,
            on_start,
            on_ready,
            http: reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build().expect("http client"),
            status: Mutex::default(),
        }
    }

    pub fn set(&self, table: Table) {
        let mut waiting = self.waiting.lock().unwrap();
        for r in &table.routes {
            if r.ready && waiting.remove(&r.key) {
                (self.on_ready)(&r.name);
            }
        }
        self.asked.lock().unwrap().clear();
        *self.table.lock().unwrap() = table;
    }
}

/** RunPod's proxy address of a pod's port 8000. */
pub fn runpod(pod: &str) -> String {
    format!("https://{pod}-8000.proxy.runpod.net")
}

/** Listens on the port for as long as the app runs. Another Hose may hold it (the installed app next to a dev build):
 * the relay says so in `status` and tries again every `retry`, so it takes over once that one quits. */
pub async fn run(relay: Arc<Relay>, port: u16, retry: Duration) {
    loop {
        let err = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => {
                relay.status.lock().unwrap().clear();
                serve(relay.clone(), listener).await.err()
            }
            Err(e) => Some(e),
        };
        if let Some(e) = err {
            *relay.status.lock().unwrap() = format!("Coding tools can't reach Hose: port {port} is busy on this Mac ({e}). Quit the other Hose; this one takes over.");
        }
        tokio::time::sleep(retry).await;
    }
}

pub async fn serve(relay: Arc<Relay>, listener: tokio::net::TcpListener) -> std::io::Result<()> {
    // a pasted screenshot is a few MB of base64; 64 MB leaves room for several
    let app = Router::new().fallback(handle).layer(DefaultBodyLimit::max(64 << 20)).with_state(relay);
    axum::serve(listener, app).await
}

/** An error the tool shows as is: Anthropic's shape on /v1/messages, OpenAI's elsewhere. */
fn error(path: &str, status: StatusCode, message: &str) -> Response {
    let body = if path.starts_with("/v1/messages") {
        serde_json::json!({ "type": "error", "error": { "type": "invalid_request_error", "message": message } })
    } else {
        serde_json::json!({ "error": { "message": message, "type": "invalid_request_error", "param": null, "code": null } })
    };
    json(status, body)
}

fn json(status: StatusCode, body: serde_json::Value) -> Response {
    Response::builder().status(status).header(header::CONTENT_TYPE, "application/json").body(Body::from(body.to_string())).unwrap()
}

/** The route a name asks for. Claude Code's background calls (titles, summaries) ask for claude-* models: they go
 * where the session's last request went. */
fn pick(routes: &[Route], name: &str, last: Option<&str>) -> Option<Route> {
    let wanted = if name.starts_with("claude-") && !routes.iter().any(|r| r.name == name) { last.unwrap_or(name) } else { name };
    routes.iter().find(|r| r.name == wanted).cloned()
}

// hop-by-hop headers, and the ones the relay sets itself
const SKIP_UP: [&str; 6] = ["host", "authorization", "x-api-key", "content-length", "connection", "accept-encoding"];
const SKIP_DOWN: [&str; 3] = ["content-length", "transfer-encoding", "connection"];

async fn handle(State(r): State<Arc<Relay>>, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    let path = uri.path().to_string();
    // Claude Code checks it can reach the server (HEAD /api/hello) before it starts
    if !path.starts_with("/v1/") {
        return json(StatusCode::OK, serde_json::json!({ "hose": "relay" }));
    }
    let (token, pod_key, routes) = {
        let t = r.table.lock().unwrap();
        (t.token.clone(), t.pod_key.clone(), t.routes.clone())
    };
    let bearer = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    if token.is_empty() || bearer != Some(token.as_str()) {
        return error(&path, StatusCode::UNAUTHORIZED, "Hose didn't recognise this key. Set up the tool again in Hose.");
    }
    if method == Method::GET && path == "/v1/models" {
        let data: Vec<_> = routes.iter().map(|r| serde_json::json!({ "id": r.name, "object": "model", "owned_by": "hose" })).collect();
        return json(StatusCode::OK, serde_json::json!({ "object": "list", "data": data }));
    }
    let Ok(mut req) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return error(&path, StatusCode::BAD_REQUEST, "Hose needs a JSON request that names a model.");
    };
    let name = req.get("model").and_then(|m| m.as_str()).unwrap_or("").to_string();
    let last = r.last.lock().unwrap().clone();
    let Some(route) = pick(&routes, &name, last.as_deref()) else {
        let names: Vec<_> = routes.iter().map(|r| r.name.as_str()).collect();
        let list = if names.is_empty() { "none yet: add a chat model in Hose".to_string() } else { names.join(", ") };
        return error(&path, StatusCode::BAD_REQUEST, &format!("Hose has no model named {name}. Names: {list}."));
    };
    *r.last.lock().unwrap() = Some(route.name.clone());

    let Some(pod) = route.pod_id.clone() else {
        if !route.can_start {
            let msg = format!("{} is off. Turn it on in Hose, or let coding tools turn it on in its Pod tab.", route.name);
            return error(&path, StatusCode::BAD_REQUEST, &msg);
        }
        if r.asked.lock().unwrap().insert(route.key.clone()) {
            r.waiting.lock().unwrap().insert(route.key.clone());
            (r.on_start)(&route.key);
        }
        let price = route.price.map(|p| format!(", ≈${p:.2}/hr")).unwrap_or_default();
        return error(&path, StatusCode::BAD_REQUEST, &format!("Hose is starting {} (about 5 min{price}). Try again then.", route.name));
    };
    let base = (r.upstream)(&pod);
    // the app polls readiness slowly while its window is hidden, so ask the pod itself before saying it's starting
    if !route.ready && !r.healthy.lock().unwrap().contains(&pod) {
        let up = r.http.get(format!("{base}/health")).timeout(Duration::from_secs(5)).send().await;
        if !up.map(|x| x.status().is_success()).unwrap_or(false) {
            return error(&path, StatusCode::BAD_REQUEST, &format!("{} is still starting. Try again in a minute.", route.name));
        }
        r.healthy.lock().unwrap().insert(pod.clone());
    }

    req["model"] = serde_json::Value::String(route.hf_id.clone());
    let target = format!("{base}{}", uri.path_and_query().map(|p| p.as_str()).unwrap_or(&path));
    let mut up = r.http.request(method, target).bearer_auth(&pod_key).body(req.to_string());
    for (k, v) in headers.iter().filter(|(k, _)| !SKIP_UP.contains(&k.as_str())) {
        up = up.header(k, v);
    }
    let res = match up.send().await {
        Ok(res) => res,
        Err(e) => return error(&path, StatusCode::BAD_GATEWAY, &format!("Hose couldn't reach {}: {e}", route.name)),
    };
    let mut out = Response::builder().status(res.status());
    for (k, v) in res.headers().iter().filter(|(k, _)| !SKIP_DOWN.contains(&k.as_str())) {
        out = out.header(k, v);
    }
    out.body(Body::from_stream(res.bytes_stream())).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::{get, post};

    #[derive(Default)]
    struct Seen {
        auth: String,
        path: String,
        body: String,
    }

    const SSE: &str = "event: message_start\ndata: {\"type\":\"message_start\"}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

    /** A stand-in pod: /health answers `health`, anything else records the request and streams SSE back. */
    async fn fake_pod(health: u16) -> (String, Arc<Mutex<Seen>>) {
        let seen = Arc::new(Mutex::new(Seen::default()));
        let s = seen.clone();
        let record = move |uri: Uri, headers: HeaderMap, body: Bytes| {
            let s = s.clone();
            async move {
                *s.lock().unwrap() = Seen {
                    auth: headers.get("authorization").map(|v| v.to_str().unwrap().to_string()).unwrap_or_default(),
                    path: uri.to_string(),
                    body: String::from_utf8(body.to_vec()).unwrap(),
                };
                Response::builder().status(200).header("content-type", "text/event-stream").body(Body::from(SSE)).unwrap()
            }
        };
        let app = Router::new()
            .route("/health", get(move || async move { StatusCode::from_u16(health).unwrap() }))
            .route("/v1/messages", post(record.clone()))
            .route("/v1/responses", post(record));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, seen)
    }

    struct Harness {
        url: String,
        relay: Arc<Relay>,
        started: Arc<Mutex<Vec<String>>>,
        noticed: Arc<Mutex<Vec<String>>>,
    }

    async fn relay(pod_url: String, routes: Vec<Route>) -> Harness {
        let started = Arc::new(Mutex::new(vec![]));
        let noticed = Arc::new(Mutex::new(vec![]));
        let (s, n) = (started.clone(), noticed.clone());
        let relay = Arc::new(Relay::new(
            Box::new(move |_| pod_url.clone()),
            Box::new(move |k| s.lock().unwrap().push(k.to_string())),
            Box::new(move |name| n.lock().unwrap().push(name.to_string())),
        ));
        relay.set(Table { token: "t1".into(), pod_key: "podkey".into(), routes });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(serve(relay.clone(), listener));
        Harness { url, relay, started, noticed }
    }

    fn coder(pod: Option<&str>, ready: bool) -> Route {
        Route {
            name: "qwen3-coder-30b".into(),
            hf_id: "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8".into(),
            pod_id: pod.map(String::from),
            ready,
            key: "k-coder".into(),
            price: Some(0.86),
            ..Default::default()
        }
    }
    fn oss(can_start: bool) -> Route {
        Route { name: "gpt-oss-20b".into(), hf_id: "openai/gpt-oss-20b".into(), can_start, key: "k-oss".into(), price: Some(0.86), ..Default::default() }
    }

    async fn post_json(url: &str, path: &str, token: Option<&str>, body: serde_json::Value) -> (u16, String, String) {
        let mut req = reqwest::Client::new().post(format!("{url}{path}")).header("content-type", "application/json").body(body.to_string());
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        let kind = res.headers().get("content-type").map(|v| v.to_str().unwrap().to_string()).unwrap_or_default();
        (status, kind, res.text().await.unwrap())
    }
    fn message(body: &str) -> String {
        let v: serde_json::Value = serde_json::from_str(body).unwrap();
        v["error"]["message"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn token() {
        let (pod, _) = fake_pod(200).await;
        let h = relay(pod, vec![coder(Some("p1"), true)]).await;

        let none = post_json(&h.url, "/v1/messages", None, serde_json::json!({ "model": "qwen3-coder-30b" })).await;
        let wrong = post_json(&h.url, "/v1/messages", Some("nope"), serde_json::json!({ "model": "qwen3-coder-30b" })).await;

        for (status, _, body) in [none, wrong] {
            assert_eq!(status, 401);
            assert_eq!(serde_json::from_str::<serde_json::Value>(&body).unwrap()["type"], "error");
            assert_eq!(message(&body), "Hose didn't recognise this key. Set up the tool again in Hose.");
        }
    }

    #[tokio::test]
    async fn forward() {
        let (pod, seen) = fake_pod(200).await;
        let h = relay(pod, vec![coder(Some("p1"), true)]).await;

        let (status, kind, body) = post_json(&h.url, "/v1/messages?beta=true", Some("t1"), serde_json::json!({ "model": "qwen3-coder-30b", "stream": true })).await;

        assert_eq!((status, kind.as_str(), body.as_str()), (200, "text/event-stream", SSE));
        let s = seen.lock().unwrap();
        assert_eq!((s.auth.as_str(), s.path.as_str()), ("Bearer podkey", "/v1/messages?beta=true"));
        let sent: serde_json::Value = serde_json::from_str(&s.body).unwrap();
        assert_eq!(sent, serde_json::json!({ "model": "Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8", "stream": true }));
    }

    #[tokio::test]
    async fn claude_names() {
        let (pod, seen) = fake_pod(200).await;
        let h = relay(pod, vec![oss(false), coder(Some("p1"), true)]).await;
        post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "qwen3-coder-30b" })).await;

        let (status, _, _) = post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "claude-haiku-4-5" })).await;

        assert_eq!(status, 200);
        assert!(seen.lock().unwrap().body.contains("Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8"));
    }

    #[tokio::test]
    async fn starts() {
        let (pod, _) = fake_pod(200).await;
        let h = relay(pod, vec![oss(true)]).await;

        let first = post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "gpt-oss-20b" })).await;
        let again = post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "gpt-oss-20b" })).await;

        assert_eq!(first.0, 400);
        assert_eq!(message(&first.2), "Hose is starting gpt-oss-20b (about 5 min, ≈$0.86/hr). Try again then.");
        assert_eq!(again.0, 400);
        assert_eq!(*h.started.lock().unwrap(), vec!["k-oss".to_string()]);
    }

    #[tokio::test]
    async fn ready_notice() {
        let (pod, _) = fake_pod(200).await;
        let h = relay(pod, vec![oss(true)]).await;
        post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "gpt-oss-20b" })).await;
        let on = Route { pod_id: Some("p2".into()), ready: true, ..oss(true) };

        h.relay.set(Table { token: "t1".into(), pod_key: "podkey".into(), routes: vec![on.clone()] });
        h.relay.set(Table { token: "t1".into(), pod_key: "podkey".into(), routes: vec![on] });

        assert_eq!(*h.noticed.lock().unwrap(), vec!["gpt-oss-20b".to_string()]);
    }

    #[tokio::test]
    async fn off() {
        let (pod, _) = fake_pod(200).await;
        let h = relay(pod, vec![oss(false)]).await;

        let off = post_json(&h.url, "/v1/responses", Some("t1"), serde_json::json!({ "model": "gpt-oss-20b" })).await;
        let unknown = post_json(&h.url, "/v1/responses", Some("t1"), serde_json::json!({ "model": "nope" })).await;

        assert_eq!(off.0, 400);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&off.2).unwrap()["error"]["type"], "invalid_request_error");
        assert_eq!(message(&off.2), "gpt-oss-20b is off. Turn it on in Hose, or let coding tools turn it on in its Pod tab.");
        assert_eq!(message(&unknown.2), "Hose has no model named nope. Names: gpt-oss-20b.");
        assert!(h.started.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn booting() {
        let (pod, seen) = fake_pod(502).await;
        let h = relay(pod, vec![coder(Some("p1"), false)]).await;

        let (status, _, body) = post_json(&h.url, "/v1/messages", Some("t1"), serde_json::json!({ "model": "qwen3-coder-30b" })).await;

        assert_eq!(status, 400);
        assert_eq!(message(&body), "qwen3-coder-30b is still starting. Try again in a minute.");
        assert!(seen.lock().unwrap().path.is_empty());
    }

    #[tokio::test]
    async fn takes_over_port() {
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = held.local_addr().unwrap().port();
        let relay = Arc::new(Relay::new(Box::new(|_| String::new()), Box::new(|_| {}), Box::new(|_| {})));
        tokio::spawn(run(relay.clone(), port, Duration::from_millis(50)));
        tokio::time::sleep(Duration::from_millis(150)).await;
        let busy = relay.status.lock().unwrap().clone();

        drop(held);
        tokio::time::sleep(Duration::from_millis(300)).await;

        assert!(busy.starts_with(&format!("Coding tools can't reach Hose: port {port} is busy")), "{busy}");
        assert_eq!(relay.status.lock().unwrap().as_str(), "");
        let res = reqwest::get(format!("http://127.0.0.1:{port}/")).await.unwrap();
        assert_eq!(res.status().as_u16(), 200);
    }

    #[tokio::test]
    async fn models() {
        let (pod, _) = fake_pod(200).await;
        let h = relay(pod, vec![coder(None, false), oss(false)]).await;

        let res = reqwest::Client::new().get(format!("{}/v1/models", h.url)).bearer_auth("t1").send().await.unwrap();

        let v: serde_json::Value = serde_json::from_str(&res.text().await.unwrap()).unwrap();
        let ids: Vec<_> = v["data"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        assert_eq!((v["object"].as_str(), ids), (Some("list"), vec!["qwen3-coder-30b".to_string(), "gpt-oss-20b".to_string()]));
    }
}
