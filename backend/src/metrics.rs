use axum::{
    extract::{MatchedPath, Request, State},
    middleware::Next,
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, QueryBuilder};
use std::time::Instant;
use tokio::sync::mpsc;
use tokio::time::{self, Duration};

#[derive(Debug, Clone)]
pub struct EndpointMetric {
    pub path: String,
    pub method: String,
    pub status_code: u16,
    pub duration_ms: f64,
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
        "INSERT INTO endpoint_metrics (path, method, status_code, duration_ms, created_at) ",
    );

    query_builder.push_values(metrics_to_insert, |mut b, item| {
        b.push_bind(item.path)
            .push_bind(item.method)
            .push_bind(item.status_code as i16)
            .push_bind(item.duration_ms)
            .push_bind(item.created_at);
    });

    let query = query_builder.build();
    if let Err(e) = query.execute(db_pool).await {
        eprintln!("[METRICS ERROR] Failed to batch flush endpoint metrics to DB: {}", e);
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

    let response = next.run(request).await;

    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let status_code = response.status().as_u16();

    collector.record(EndpointMetric {
        path: matched_path,
        method,
        status_code,
        duration_ms,
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
            created_at: Utc::now(),
        });

        let received = rx.recv().await;
        assert!(received.is_some());
        let item = received.unwrap();
        assert_eq!(item.path, "/test");
        assert_eq!(item.method, "GET");
        assert_eq!(item.status_code, 200);
        assert_eq!(item.duration_ms, 12.5);
    }
}

