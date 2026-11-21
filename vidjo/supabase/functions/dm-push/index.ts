// Supabase Edge Function: send a browser push when a direct message is inserted.
//
// Deploy with:
//   supabase functions deploy dm-push
//
// Then create a Database Webhook (Dashboard -> Database -> Webhooks) for
// INSERT on public.vidjo_dm_messages pointing at this function, and set the
// VAPID secrets described in supabase/README.md.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type MessageRow = {
	id: string;
	thread_id: string;
	sender_id: string;
	body: string | null;
	image_path?: string | null;
	gif_url?: string | null;
	file_path?: string | null;
};

type SubscriptionRow = {
	endpoint: string;
	p256dh: string;
	auth: string;
	user_id: string;
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' }
	});
}

function preview(row: MessageRow) {
	if (row.body && row.body.trim()) return row.body.slice(0, 140);
	if (row.image_path) return 'Sent a photo';
	if (row.gif_url) return 'Sent a GIF';
	if (row.file_path) return 'Sent a file';
	return 'Sent a shared page';
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') return json({}, 204);
	if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
	const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
	const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

	if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate) {
		console.error('[dm-push] Missing SUPABASE_URL, service role key or VAPID keys.');
		return json({ error: 'Push is not configured' }, 500);
	}

	// Only the database webhook configured in the README knows the service role
	// key. Reject direct calls so the function cannot be used to spam users.
	if (req.headers.get('authorization') !== `Bearer ${serviceKey}`) {
		return json({ error: 'Unauthorized' }, 401);
	}

	let record: MessageRow;
	try {
		const payload = (await req.json()) as { record?: MessageRow };
		record = payload.record as MessageRow;
	} catch {
		return json({ error: 'Invalid payload' }, 400);
	}

	if (!record?.thread_id || !record?.sender_id || !record?.id) {
		return json({ ignored: 'Not a message insert' });
	}

	const admin = createClient(supabaseUrl, serviceKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	// Everyone in the thread except the author gets a notification.
	const { data: participants, error: participantsError } = await admin
		.from('vidjo_dm_participants')
		.select('user_id')
		.eq('thread_id', record.thread_id)
		.neq('user_id', record.sender_id);

	if (participantsError) {
		console.error('[dm-push] Could not load participants.', participantsError);
		return json({ error: 'Could not load participants' }, 500);
	}

	const recipientIds = [...new Set((participants ?? []).map((row) => row.user_id as string))];
	if (recipientIds.length === 0) return json({ sent: 0 });

	const [{ data: subscriptions, error: subscriptionsError }, { data: sender }] = await Promise.all([
		admin
			.from('vidjo_push_subscriptions')
			.select('endpoint, p256dh, auth, user_id')
			.in('user_id', recipientIds),
		admin
			.from('vidjo_profiles')
			.select('display_name, username')
			.eq('user_id', record.sender_id)
			.maybeSingle()
	]);

	if (subscriptionsError) {
		console.error('[dm-push] Could not load subscriptions.', subscriptionsError);
		return json({ error: 'Could not load subscriptions' }, 500);
	}

	if (!subscriptions?.length) return json({ sent: 0 });

	const senderName = sender?.display_name || sender?.username || 'A VidJo friend';
	webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

	const payload = JSON.stringify({
		title: `${senderName}: ${preview(record)}`,
		body: 'Tap to open the conversation in VidJo.',
		tag: `vidjo-dm-${record.thread_id}`,
		url: '/'
	});

	const results = await Promise.allSettled(
		(subscriptions as SubscriptionRow[]).map(async (subscription) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: subscription.endpoint,
						keys: { p256dh: subscription.p256dh, auth: subscription.auth }
					},
					payload
				);
			} catch (cause) {
				const status = (cause as { statusCode?: number }).statusCode;
				// Expired subscriptions can never succeed; remove them.
				if (status === 404 || status === 410) {
					await admin
						.from('vidjo_push_subscriptions')
						.delete()
						.eq('endpoint', subscription.endpoint);
				} else {
					console.error('[dm-push] Delivery failed.', cause);
				}
				throw cause;
			}
		})
	);

	const sent = results.filter((result) => result.status === 'fulfilled').length;
	return json({ sent, attempted: results.length });
});
