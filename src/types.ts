export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: string[];  // base64 image data list (without data URI prefix)
  activity?: {
    type: 'web_search';
    label: string;
    status: 'active' | 'done';
  };
}

export interface ToolLampState {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  animKey: number;
}
