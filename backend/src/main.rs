use blitz_auction_backend::server::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let server = Server::build().await?;
    server.serve().await?;
    Ok(())
}
