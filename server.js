import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';

import { sendMonthlyExports, sendInactivityReminders } from './src/lib/scheduledEmails.js';
import entriesRouter from './src/routes/entries.js';
import communitiesRouter from './src/routes/communities.js';
import connectionsRouter from './src/routes/connections.js';
import commentsRouter from './src/routes/comments.js';
import studyMaterialsRouter from './src/routes/studyMaterials.js';
import livekitRouter from './src/routes/livekit.js';
import bibleRouter from './src/routes/bible.js';
import profileRouter from './src/routes/profile.js';
import featuredMaterialsRouter from './src/routes/featuredMaterials.js';
import peerConnectionsRouter from './src/routes/peerConnections.js';
import notificationsRouter from './src/routes/notifications.js';
import usersRouter from './src/routes/users.js';
import messagesRouter from './src/routes/messages.js';
import moderationRouter from './src/routes/moderation.js';
import publicPostsRouter from './src/routes/publicPosts.js';

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
app.use('/api/peer-connections', peerConnectionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/users', usersRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/moderation', moderationRouter);
app.use('/api/public-posts', publicPostsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Guardian backend running on port ${PORT}`));

// 1st of every month, 08:00 UTC — email everyone a PDF of their journal
cron.schedule('0 8 1 * *', () => {
  console.log('Running monthly journal export job...');
  sendMonthlyExports().catch((err) => console.error('Monthly export job failed:', err));
});

// Daily, 09:00 UTC — remind anyone quiet for 7+ days to come write
cron.schedule('0 9 * * *', () => {
  console.log('Running inactivity reminder job...');
  sendInactivityReminders().catch((err) => console.error('Inactivity reminder job failed:', err));
});
