import cors from 'cors';

// https://blog.logrocket.com/how-to-set-up-node-typescript-express/
import express, { Express } from 'express';

import './config';

import { GeminiController } from './controllers/gemini.controller';
import { LeaderboardsController } from './controllers/leaderboards.controller';
import { MatchResultsController } from './controllers/match-results.controller';
import { MatchesController } from './controllers/matches.controller';
import { PlayersController } from './controllers/players.controller';

const app: Express = express();

// Remove powered-by Express header
app.disable('x-powered-by');

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));

// Middleware to parse JSON request bodies
app.use(express.json());

// Middleware to parse URL-encoded request bodies
app.use(express.urlencoded({ extended: true }));

app.use('/players', PlayersController);
app.use('/matches', MatchesController);
app.use('/match-results', MatchResultsController);
app.use('/gemini', GeminiController);
app.use('/leaderboards', LeaderboardsController);

app.get('/', (req, res) => {
  res.send('Foosball API is running!');
});

// Basic error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API Error:', err.stack || err.message || err); // Log the error
  res.status(err.status || 500).json({
    // Send JSON error response
    message: err.message || 'Something went wrong!',
  });
});

export { app };
