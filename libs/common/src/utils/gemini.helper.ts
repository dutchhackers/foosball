import { GeminiClient, initializeClient } from '@foosball/gemini';
import { GenerativeModel } from '@google/generative-ai';

export class GeminiHelper {
  #client: GeminiClient;
  #model: GenerativeModel = null;

  constructor() {
    this.#client = initializeClient(process.env.GEMINI_API_KEY);
  }

  async generateProfileCardReview(input: string) {
    const model = this.#client.genAI.getGenerativeModel({
      model: 'gemini-1.5-pro',
      systemInstruction:
        "Context: inhouse there's a table soccer competition in company Move. Player Cards reflect how players are performing.\n\nEach game will end when a team (2 players) reaches 10 points. However, a \"klinker\" is when the ball bounces back and you will get 2 points. When you win with 11 points, you've suckerpunched your opponent. However, if you got beaten with 11 points, you've got knocked out.\n\nIf you win with 10 to 0 (or 11 to 0), this is maximum humilliation and the losers will have to crawl under the table.\n\nWins: the number of times that a player (team of 2) win a game\nKnockouts: how many times you lost with a 11 goal  score\nKroep'n: \n\n\nYou respond in typical Chuck Norris style. Divide into max 2 paragraphs and use some slack emojis at the and. You may be sarcastic.\n",
    });

    const generationConfig = {
      temperature: 1,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain',
    };

    const chatSession = model.startChat({
      generationConfig,
      // safetySettings: Adjust safety settings
      // See https://ai.google.dev/gemini-api/docs/safety-settings
    });

    const result = await chatSession.sendMessage(JSON.stringify(input));
    return result.response.text();
  }

  async generateMatchResultShout(input: string) {
    const generationConfig = {
      temperature: 1,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain',
    };

    const parts = [
      {
        text: "You are the reporter of the world champions league in soccer. Table soccer it is. When the game is finished and you here the end score, you make up a nice sentence. The game is finished when the first team of 2 players reaches 10. Or 11 (max) when the team ends with a double point. If the opponent still has 0 (means no score) you've humiliated the other team to the max. Be nice and friendly with a bit of humor. Always add a second sentence with a sarcastic tip for the next time.\n\n\nWhen 11 is reach, use the work 'suckerpunched' om something similar. Keep your tone like the voice from Fifa arcade game\n\nKeep the output short.",
      },
      { text: 'input: Jim & Jake versus John & Jane: 3-10' },
      { text: 'output: John and Jane slayed Jim and Jake with 10-3' },
      { text: 'input: John & Jake versus Jimmy & Jarrod: 10-5' },
      { text: 'output: John and Jake rekt Jimmy and Jarrod with 10-5' },
      { text: 'input: John & Cas versus Jimmy & John: 10-7' },
      { text: 'output: John and Jake defeated Jimmy and Jarrod with 10-7' },
      { text: 'input: Jake & Jimmy versus John & Jos: 10-8' },
      { text: 'output: Jake and Jimmy crushed Jarrod and Jos with 10-8' },
      { text: 'input: Jos & John versus Jimmy & Jake: 10-9' },
      { text: 'output: Jos and Jarrod :rekt: Jimmy and Jake with 10-9' },
      { text: 'input: John & Jake versus Jimmy & Jarrod: 11-7' },
      { text: 'output: John and Jake suckerpunched Jimmy and Jarrod with 11-7' },
      { text: 'input: Jos & Jake versus Jarrod & Jimmy: 10-0' },
      { text: 'output: Jos and Jake annihilated Jarrod and Jimmy with 10-0' },
      { text: 'input: Jos & Jake versus Jarrod & Jimmy: 10-7' },
      { text: 'output: Jos and Jake vanquished Jarrod and Jimmy with 10-2' },
      { text: 'input: ' + input },
      { text: 'output: ' },
    ];

    const model = this.getModel();

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig,
    });

    return result.response.text();
  }

  private getModel() {
    if (this.#model == null) {
      this.#model = this.#client.genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });
    }
    return this.#model;
  }
}
