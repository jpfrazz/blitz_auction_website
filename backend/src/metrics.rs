use axum::{
    body::{to_bytes, Body},
    extract::{MatchedPath, Request, State},
    http::{header, HeaderMap},
    middleware::Next,
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::time::{self, Duration};

const MAX_BYTE_BUFFER: usize = 64 * 1024; // 64 KB buffer limit for metrics
const MAX_STORED_CHARS: usize = 2000; // 2,000 max stored characters

#[derive(Debug, Clone)]
pub struct EndpointMetric {
    pub path: String,
    pub method: String,
    pub status_code: u16,
    pub duration_ms: f64,
    pub request: String,
    pub response: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct MetricsCollector {
    sender: mpsc::Sender<EndpointMetric>,
}

impl MetricsCollector {
    pub fn new(sender: mpsc::Sender<EndpointMetric>) -> Self {
        Self { sender }
    }

    pub fn record(&self, metric: EndpointMetric) {
        // Non-blocking try_send ensures endpoint responses are never delayed by collection
        if let Err(e) = self.sender.try_send(metric) {
            eprintln!("[METRICS WARNING] Failed to record endpoint metric: {}", e);
        }
    }
}

pub fn init_metrics_collector(db_pool: PgPool) -> MetricsCollector {
    let (tx, mut rx) = mpsc::channel::<EndpointMetric>(10000);
    let collector = MetricsCollector::new(tx);

    tokio::spawn(async move {
        let mut buffer: Vec<EndpointMetric> = Vec::with_capacity(100);
        let mut interval = time::interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                maybe_item = rx.recv() => {
                    match maybe_item {
                        Some(item) => {
                            buffer.push(item);
                            if buffer.len() >= 100 {
                                flush_metrics(&db_pool, &mut buffer).await;
                            }
                        }
                        None => {
                            if !buffer.is_empty() {
                                flush_metrics(&db_pool, &mut buffer).await;
                            }
                            break;
                        }
                    }
                }
                _ = interval.tick() => {
                    if !buffer.is_empty() {
                        flush_metrics(&db_pool, &mut buffer).await;
                    }
                }
            }
        }
    });

    collector
}

async fn flush_metrics(db_pool: &PgPool, buffer: &mut Vec<EndpointMetric>) {
    if buffer.is_empty() {
        return;
    }

    let metrics_to_insert = std::mem::take(buffer);

    let mut query_builder: QueryBuilder<sqlx::Postgres> = QueryBuilder::new(
        "INSERT INTO endpoint_metrics (path, method, status_code, duration_ms, request, response, created_at) ",
    );

    query_builder.push_values(metrics_to_insert, |mut b, item| {
        b.push_bind(item.path)
            .push_bind(item.method)
            .push_bind(item.status_code as i16)
            .push_bind(item.duration_ms)
            .push_bind(item.request)
            .push_bind(item.response)
            .push_bind(item.created_at);
    });

    let query = query_builder.build();
    if let Err(e) = query.execute(db_pool).await {
        eprintln!("[METRICS ERROR] Failed to batch flush endpoint metrics to DB: {}", e);
    }
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        None => s.to_string(),
        Some((idx, _)) => format!("{}... (truncated)", &s[..idx]),
    }
}

fn is_text_or_json(headers: &HeaderMap) -> bool {
    if let Some(content_type) = headers.get(header::CONTENT_TYPE) {
        if let Ok(ct) = content_type.to_str() {
            let lower = ct.to_lowercase();
            return lower.contains("application/json")
                || lower.contains("text/")
                || lower.contains("application/x-www-form-urlencoded");
        }
    }
    false
}

async fn extract_body_string(
    headers: &HeaderMap,
    body: Body,
    max_bytes: usize,
    max_chars: usize,
) -> (String, Body) {
    if let Some(cl) = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
        if cl == "0" {
            return ("".to_string(), body);
        }
    }

    if is_text_or_json(headers) {
        let bytes = to_bytes(body, max_bytes).await.unwrap_or_default();
        let s = truncate_str(&String::from_utf8_lossy(&bytes), max_chars);
        (s, Body::from(bytes))
    } else if headers.contains_key(header::CONTENT_TYPE) || headers.contains_key(header::CONTENT_LENGTH) {
        let content_type = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown type");
        let content_length = headers
            .get(header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .map(|len| format!("{} bytes", len))
            .unwrap_or_else(|| "unknown length".to_string());

        (format!("<Content Type: {}, Length: {}>", content_type, content_length), body)
    } else {
        let bytes = to_bytes(body, max_bytes).await.unwrap_or_default();
        if bytes.is_empty() {
            ("".to_string(), Body::from(bytes))
        } else {
            let s = truncate_str(&String::from_utf8_lossy(&bytes), max_chars);
            (s, Body::from(bytes))
        }
    }
}

pub async fn track_metrics_middleware(
    State(collector): State<MetricsCollector>,
    request: Request,
    next: Next,
) -> Response {
    let start = Instant::now();
    let method = request.method().to_string();

    let matched_path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|path| path.as_str().to_string())
        .unwrap_or_else(|| request.uri().path().to_string());

    let (req_parts, req_body) = request.into_parts();
    let (request_str, req_body) =
        extract_body_string(&req_parts.headers, req_body, MAX_BYTE_BUFFER, MAX_STORED_CHARS).await;
    let request = Request::from_parts(req_parts, req_body);

    let response = next.run(request).await;

    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let status_code = response.status().as_u16();

    let (res_parts, res_body) = response.into_parts();
    let (response_str, res_body) =
        extract_body_string(&res_parts.headers, res_body, MAX_BYTE_BUFFER, MAX_STORED_CHARS).await;
    let response = Response::from_parts(res_parts, res_body);

    collector.record(EndpointMetric {
        path: matched_path,
        method,
        status_code,
        duration_ms,
        request: request_str,
        response: response_str,
        created_at: Utc::now(),
    });

    response
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct AggregateMetricSummary {
    pub path: String,
    pub method: String,
    pub request_count: i64,
    pub avg_duration_ms: f64,
    pub min_duration_ms: f64,
    pub max_duration_ms: f64,
    pub p95_duration_ms: f64,
    pub p99_duration_ms: f64,
    pub error_count: i64,
}

pub async fn get_aggregate_metrics(
    db_pool: &PgPool,
) -> Result<Vec<AggregateMetricSummary>, sqlx::Error> {
    let records = sqlx::query_as::<_, AggregateMetricSummary>(
        r#"
        SELECT 
            path,
            method,
            COUNT(*) as request_count,
            COALESCE(AVG(duration_ms), 0.0) as avg_duration_ms,
            COALESCE(MIN(duration_ms), 0.0) as min_duration_ms,
            COALESCE(MAX(duration_ms), 0.0) as max_duration_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0.0) as p95_duration_ms,
            COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration_ms), 0.0) as p99_duration_ms,
            COUNT(*) FILTER (WHERE status_code >= 400) as error_count
        FROM endpoint_metrics
        GROUP BY path, method
        ORDER BY request_count DESC, avg_duration_ms DESC
        "#,
    )
    .fetch_all(db_pool)
    .await?;

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_metrics_collector_non_blocking() {
        let (tx, mut rx) = mpsc::channel::<EndpointMetric>(10);
        let collector = MetricsCollector::new(tx);

        collector.record(EndpointMetric {
            path: "/test".to_string(),
            method: "GET".to_string(),
            status_code: 200,
            duration_ms: 12.5,
            request: "{}".to_string(),
            response: "{\"status\":\"ok\"}".to_string(),
            created_at: Utc::now(),
        });

        let received = rx.recv().await;
        assert!(received.is_some());
        let item = received.unwrap();
        assert_eq!(item.path, "/test");
        assert_eq!(item.method, "GET");
        assert_eq!(item.status_code, 200);
        assert_eq!(item.duration_ms, 12.5);
        assert_eq!(item.request, "{}");
        assert_eq!(item.response, "{\"status\":\"ok\"}");
    }
}
