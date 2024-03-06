use std::ops::IndexMut;

use crate::{
    data::models::ServerDatasetConfiguration, errors::ServiceError, get_env,
    handlers::chunk_handler::ScoreChunkDTO,
};
use openai_dive::v1::{
    api::Client,
    resources::embedding::{EmbeddingInput, EmbeddingOutput, EmbeddingParameters},
};
use serde::{Deserialize, Serialize};

pub async fn create_embedding(
    message: &str,
    embed_type: &str,
    dataset_config: ServerDatasetConfiguration,
) -> Result<Vec<f32>, actix_web::Error> {
    let parent_span = sentry::configure_scope(|scope| scope.get_span());
    let transaction: sentry::TransactionOrSpan = match &parent_span {
        Some(parent) => parent
            .start_child("create_embedding", "Create semantic dense embedding")
            .into(),
        None => {
            let ctx = sentry::TransactionContext::new(
                "create_embedding",
                "Create semantic dense embedding",
            );
            sentry::start_transaction(ctx).into()
        }
    };
    sentry::configure_scope(|scope| scope.set_span(Some(transaction.clone())));

    let open_ai_api_key = get_env!("OPENAI_API_KEY", "OPENAI_API_KEY should be set").into();
    let base_url = dataset_config.EMBEDDING_BASE_URL;

    let base_url = if base_url.is_empty() {
        "https://api.openai.com/v1".to_string()
    } else if base_url.contains("https://embedding.trieve.ai") {
        match std::env::var("EMBEDDING_SERVER_ORIGIN")
            .ok()
            .filter(|s| !s.is_empty())
        {
            Some(origin) => origin,
            None => get_env!(
                "GPU_SERVER_ORIGIN",
                "GPU_SERVER_ORIGIN should be set if this is called"
            )
            .to_string(),
        }
    } else {
        base_url
    };

    let client = Client {
        http_client: None,
        api_key: open_ai_api_key,
        base_url,
        organization: None,
    };

    let input = match embed_type {
        "doc" => EmbeddingInput::String(message.to_string()),
        "query" => EmbeddingInput::String(dataset_config.EMBEDDING_QUERY_PREFIX + message),
        _ => EmbeddingInput::String(message.to_string()),
    };

    // Vectorize
    let parameters = EmbeddingParameters {
        model: "text-embedding-3-small".to_string(),
        input,
        user: None,
        encoding_format: None,
        dimensions: None,
    };

    let embeddings =
        client.embeddings().create(parameters).await.map_err(|e| {
            ServiceError::BadRequest(format!("Failed making call to server {:?}", e))
        })?;

    let vector = match embeddings.data.first().unwrap().embedding.clone() {
        EmbeddingOutput::Float(vector) => vector,
        _ => vec![],
    };

    transaction.finish();
    Ok(vector.iter().map(|&x| x as f32).collect())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpladeEmbedding {
    pub embeddings: Vec<(u32, f32)>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomSparseEmbedData {
    pub input: String,
    pub encode_type: String,
}

pub async fn get_splade_embedding(
    message: &str,
    embed_type: &str,
) -> Result<Vec<(u32, f32)>, ServiceError> {
    if message.is_empty() {
        return Err(ServiceError::BadRequest(
            "Cannot encode empty query".to_string(),
        ));
    }

    let server_origin = match std::env::var("SPARSE_SERVER_ORIGIN")
        .ok()
        .filter(|s| !s.is_empty())
    {
        Some(origin) => origin,
        None => get_env!(
            "GPU_SERVER_ORIGIN",
            "GPU_SERVER_ORIGIN should be set if this is called"
        )
        .to_string(),
    };

    let embedding_server_call = format!("{}/sparse_encode", server_origin);

    let resp = ureq::post(&embedding_server_call)
        .set("Content-Type", "application/json")
        .set(
            "Authorization",
            &format!(
                "Bearer {}",
                get_env!("OPENAI_API_KEY", "OPENAI_API should be set")
            ),
        )
        .send_json(CustomSparseEmbedData {
            input: message.to_string(),
            encode_type: embed_type.to_string(),
        })
        .map_err(|err| ServiceError::BadRequest(format!("Failed making call to server {:?}", err)))?
        .into_json::<SpladeEmbedding>()
        .map_err(|_e| {
            log::error!(
                "Failed parsing response from custom embedding server {:?}",
                _e
            );
            ServiceError::BadRequest(
                "Failed parsing response from custom embedding server".to_string(),
            )
        })?;

    Ok(resp.embeddings)
}

#[derive(Debug, Serialize, Deserialize)]
struct ScorePair {
    index: usize,
    score: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReRankResponse {
    pub docs: Vec<(String, f32)>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CrossEncoderData {
    pub query: String,
    pub texts: Vec<String>,
    pub truncate: bool,
}

pub async fn cross_encoder(
    query: String,
    page_size: u64,
    results: Vec<ScoreChunkDTO>,
) -> Result<Vec<ScoreChunkDTO>, actix_web::Error> {
    log::info!("Doing criss cross");
    let parent_span = sentry::configure_scope(|scope| scope.get_span());
    let transaction: sentry::TransactionOrSpan = match &parent_span {
        Some(parent) => parent
            .start_child("Cross Encoder", "Cross Encode semantic and hybrid chunks")
            .into(),
        None => {
            let ctx = sentry::TransactionContext::new(
                "Cross Encoder",
                "Cross Encode semantic and hybrid chunks",
            );
            sentry::start_transaction(ctx).into()
        }
    };
    sentry::configure_scope(|scope| scope.set_span(Some(transaction.clone())));

    let server_origin: String = match std::env::var("RERANKER_SERVER_ORIGIN")
        .ok()
        .filter(|s| !s.is_empty())
    {
        Some(origin) => origin,
        None => get_env!(
            "GPU_SERVER_ORIGIN",
            "GPU_SERVER_ORIGIN should be set if this is called"
        )
        .to_string(),
    };

    let embedding_server_call = format!("{}/rerank", server_origin);
    log::info!("Server {:?}", embedding_server_call);

    if results.is_empty() {
        return Ok(vec![]);
    }

    let request_docs = results
        .clone()
        .into_iter()
        .map(|x| x.metadata[0].clone().content)
        .collect::<Vec<String>>();

    let resp = ureq::post(&embedding_server_call)
        .set("Content-Type", "application/json")
        .set(
            "Authorization",
            &format!(
                "Bearer {}",
                get_env!("OPENAI_API_KEY", "OPENAI_API should be set")
            ),
        )
        .send_json(CrossEncoderData {
            query,
            texts: request_docs,
            truncate: true,
        })
        .map_err(|err| ServiceError::BadRequest(format!("Failed making call to server {:?}", err)))?
        .into_json::<Vec<ScorePair>>()
        .map_err(|_e| {
            log::error!(
                "Failed parsing response from custom embedding server {:?}",
                _e
            );
            ServiceError::BadRequest(
                "Failed parsing response from custom embedding server".to_string(),
            )
        })?;

    let mut results = results.clone();

    resp.into_iter().for_each(|pair| {
        results.index_mut(pair.index).score = pair.score as f64;
    });

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());

    results.truncate(page_size.try_into().unwrap());

    transaction.finish();
    Ok(results)
}
