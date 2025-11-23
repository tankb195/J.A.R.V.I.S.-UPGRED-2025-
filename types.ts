export interface MessageLog {
  id: string;
  sender: 'user' | 'jarvis';
  text: string;
  timestamp: Date;
  isReport?: boolean;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioFrequencyData {
  values: Uint8Array;
}