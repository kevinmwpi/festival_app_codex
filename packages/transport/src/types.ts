export interface OutboundMessage {
  id: string;
  group_id: string;
  client_message_id: string;
  body: string;
  sent_at: string;
}

export interface InboundMessage extends OutboundMessage {
  sender_user_id: string;
  transport_type: 'cloud' | 'ble';
}

export interface MessagingTransport {
  send(message: OutboundMessage): Promise<void>;
  onReceive(handler: (message: InboundMessage) => void): () => void;
  getTransportType(): 'cloud' | 'ble';
}
