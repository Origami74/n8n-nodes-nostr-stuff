import { EventStore } from 'applesauce-core';
import {
	mapEventsToStore,
	mapEventsToTimeline,
	withImmediateValueOrDefault,
} from 'applesauce-core';
import { RelayPool, onlyEvents } from 'applesauce-relay';
import { createEventLoader } from 'applesauce-loaders/dist/loaders';
import { NostrEvent, Filter } from 'nostr-tools';
import { merge, distinct, firstValueFrom, timeout, map } from 'rxjs';

/**
 * Shared applesauce instances for the n8n nodes
 * These are created once and reused across all node executions
 */

// Create a relay pool for managing connections
export const relayPool = new RelayPool();

// Create an event store for caching events
export const eventStore = new EventStore();

/**
 * Create an event loader with the given relays
 * @param relays Array of relay URLs
 * @param bufferTime Optional buffer time in ms (default: 500)
 */
export function createLoader(relays: string[], bufferTime = 500) {
	return createEventLoader(relayPool, {
		eventStore,
		extraRelays: relays,
		bufferTime,
	});
}

/**
 * Publish an event to multiple relays using applesauce
 * @param event The event to publish
 * @param relays Array of relay URLs
 * @param timeoutMs Timeout in milliseconds
 */
export async function publishEvent(
	event: NostrEvent,
	relays: string[],
	timeoutMs = 10000,
): Promise<{ relay: string; success: boolean; error?: string }[]> {
	try {
		// Publish to all relays using RelayPool
		const responses = await Promise.race([
			relayPool.publish(relays, event),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Publish timeout')), timeoutMs),
			),
		]);

		// Map responses to our result format
		return responses.map((response: any) => ({
			relay: response.from,
			success: response.success,
			error: response.success ? undefined : response.message,
		}));
	} catch (error) {
		// If timeout or error, return failure for all relays
		return relays.map((relay) => ({
			relay,
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		}));
	}
}

/**
 * Fetch events from relays using applesauce with RxJS
 * @param filter Nostr filter
 * @param relays Array of relay URLs
 * @param timeoutMs Timeout in milliseconds
 */
export async function fetchEvents(
	filter: Filter,
	relays: string[],
	timeoutMs = 30000,
): Promise<NostrEvent[]> {
	// Create observable that merges store and relay subscriptions
	const events$ = merge(
		// Get events from local store
		eventStore.filters(filter),
		// Subscribe to relays for new events
		relayPool.subscription(relays, filter).pipe(onlyEvents()),
	).pipe(
		onlyEvents(),
		// Add new events to store
		mapEventsToStore(eventStore),
		// Only take a single instance of each event based on id (deduplication)
		distinct((e: NostrEvent) => e.id),
		// Create a timeline of events (array)
		mapEventsToTimeline(),
		// Provide immediate value or default
		withImmediateValueOrDefault([]),
		// Map to just the events array
		map((timeline: NostrEvent[]) => timeline),
	);

	// Convert observable to promise with timeout
	try {
		const events = await firstValueFrom(
			events$.pipe(
				timeout({
					each: timeoutMs,
					with: () => {
						throw new Error('Fetch timeout');
					},
				}),
			),
		);
		return events;
	} catch (error) {
		// If timeout or error, return empty array
		return [];
	}
}

/**
 * Deduplicate events by ID
 * @param events Array of events
 */
export function deduplicateEvents(events: NostrEvent[]): NostrEvent[] {
	const seen = new Set<string>();
	const deduplicated: NostrEvent[] = [];

	for (const event of events) {
		if (!seen.has(event.id)) {
			seen.add(event.id);
			deduplicated.push(event);
		}
	}

	return deduplicated;
}

/**
 * Parse relay input - supports both JSON array and comma-separated strings
 * @param input Relay input (JSON array string or comma-separated string)
 */
export function parseRelayInput(input: string): string[] {
	// Try to parse as JSON first
	try {
		const parsed = JSON.parse(input);
		if (Array.isArray(parsed)) {
			return parsed.filter((r) => typeof r === 'string' && r.trim().length > 0);
		}
	} catch {
		// Not JSON, treat as comma-separated
	}

	// Fall back to comma-separated
	return input
		.split(',')
		.map((r) => r.trim())
		.filter((r) => r.length > 0);
}
