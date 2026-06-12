import { GoogleGenerativeAI } from '@google/generative-ai';

export function initializeClient(apiKey: string): GeminiClient {
  const client = new GeminiClient(apiKey);
  return client;
}

export class GeminiClient {
  #genAI: GoogleGenerativeAI | null = null;

  constructor(apiKey: string) {
    console.log('initialize GeminiClient', apiKey);
    this.#genAI = new GoogleGenerativeAI(apiKey);
  }

  get genAI() {
    if (this.#genAI == null) {
      throw new Error('GeminiClient not initialized');
    }

    return this.#genAI;
  }
}
