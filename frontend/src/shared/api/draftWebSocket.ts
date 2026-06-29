// Utility to connect to a draft websocket and handle messages
// Usage: connectDraftWebSocket(draftId, onDraftState)
import { Auction, Draft } from '../../types';

export function connectDraftWebSocket(
  draftId: string,
  onDraftState: (draft: Draft) => void,
  onAuctionState: (auction: Auction) => void,
  onStatusChange?: (connected: boolean) => void
) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/api/ws/${draftId}`;
  const ws = new window.WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    if (onStatusChange) onStatusChange(true);
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      console.log('WebSocket message received:', msg);
      switch (msg.type) {
        case 'DraftUpdate':
          onDraftState(msg.data);
          break;
        case 'AuctionUpdate':
          onAuctionState(msg.data);
          break;
      }
    } catch (e) {
      console.error('Error parsing websocket message', e);
    }
  };
  ws.onclose = () => {
    console.log('WebSocket closed');
    if (onStatusChange) onStatusChange(false);
  };
  ws.onerror = (e) => {
    console.error('WebSocket error', e);
    if (onStatusChange) onStatusChange(false);
  };
  return ws;
}
