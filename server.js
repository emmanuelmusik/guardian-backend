import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import entriesRouter from './src/routes/entries.js';
import communitiesRouter from './src/routes/communities.js';
import connectionsRouter from './src/routes/connections.js';
import commentsRouter from './src/routes/comments.js';
import studyMaterialsRouter from './src/routes/studyMaterials.js';
import livekitRouter from './src/routes/livekit.js';
import bibleRouter from './src/routes/bible.js';
import profileRouter from './src/routes/profile.js';
import featuredMaterialsRouter from './src/routes/featuredMaterials.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/entries', entriesRouter);
app.use('/api/communities', communitiesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/study-materials', studyMaterialsRouter);
app.use('/api/livekit', livekitRouter);
app.use('/api/bible', bibleRouter);
app.use('/api/profile', profileRouter);
app.use('/api/featured-materials', featuredMaterialsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Guardian backend running on port ${PORT}`));
