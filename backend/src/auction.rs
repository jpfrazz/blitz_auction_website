use serde::{Serialize};


#[derive(Clone, Debug, Serialize)]
pub struct Auction {
    pub auction_id: u32,
    pokedex_id: u32,
    pokemon_name: String,
    pokemon_form: String,
    pub highest_bid: u32,
    pub highest_bidder: Option<String>,
}

impl Auction {
    fn new() -> Auction {
        todo!()
    }
}
