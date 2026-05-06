import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import 'dotenv/config';
import './db';
import adminUpload from './routes/admin-upload';
import adminQuota from './routes/admin-quota';
import adminSettings from './routes/admin-settings';
import admin from './routes/admin';
import api from './routes/api';

const app = new Hono();

// /admin is now a permanent redirect to / — the dashboard moved to the
// homepage. Old bookmarks + htmx links keep working.
app.get('/admin', (c) => c.redirect('/', 302));

app.route('/admin/upload', adminUpload);
app.route('/admin/quota', adminQuota);
app.route('/admin/settings', adminSettings);
app.route('/api', api);
// Mount the dashboard at the root LAST so the more-specific /admin/* prefixes
// above win when the URL has /admin/...
app.route('/', admin);

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Hendon Signal Agent listening on http://localhost:${info.port}`);
});
