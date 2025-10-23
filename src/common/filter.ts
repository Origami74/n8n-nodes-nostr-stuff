import { Filter } from 'nostr-tools';
import { getHexEventId, getHexPubKey } from '../convert/get-hex';

export enum FilterStrategy {
	customFilter = 'customFilter',
	eventid = 'eventid',
	hashtag = 'hashtag',
	mention = 'mention',
	rawFilter = 'rawFilter',
	textSearch = 'textSearch',
	pubkey = 'pubkey',
	nip04 = 'nip-04',
}

export function buildFilter(
	strategy: FilterStrategy,
	info: Partial<Record<FilterStrategy, string | undefined>>,
	since?: number,
	until?: number,
	kinds = [1],
	sinceNow = false,
): Filter {
	let filter = {};

	const specificData = info[strategy];

	if (!specificData) {
		throw new Error('No data');
	}

	switch (strategy) {
		case 'customFilter':
			if (!specificData) throw new Error('Custom filter JSON is required');
			const customFilterString = specificData;

			let customJson;
			try {
				customJson = JSON.parse(customFilterString);
			} catch (error) {
				console.warn('Json parse failed for custom filter.');
				throw error;
			}

			// If sinceNow is true, always override since with current timestamp
			if (sinceNow) {
				customJson.since = Math.floor(Date.now() / 1000);
			} else if (since !== undefined && !customJson.since) {
				// Only apply since if not already in the filter and sinceNow is false
				customJson.since = since;
			}

			if (until !== undefined && !customJson.until) {
				customJson.until = until;
			}

			filter = customJson;
			break;

		case 'pubkey':
			if (!specificData) throw new Error('Public key is required');
			const pubkey = getHexPubKey(specificData);

			filter = {
				kinds,
				authors: [pubkey],
				since,
				until,
			};
			break;

		case 'eventid':
			if (!specificData) throw new Error('Event ID is required');
			const si = getHexEventId(specificData);

			filter = {
				ids: [si.special],
				limit: 1,
			};
			break;

		case 'textSearch':
			if (!specificData) throw new Error('Search word is required');
			const searchWord = specificData;

			filter = {
				kinds,
				search: searchWord,
				since,
				until,
			};

			break;

		case 'hashtag':
			if (!specificData) throw new Error('Hashtag is required');
			let tagString = specificData;
			tagString = tagString.replace('#', '');

			filter = {
				kinds,
				'#t': [tagString],
				since,
				until,
			};

			break;

		case 'rawFilter':
			if (!specificData) throw new Error('Filter JSON is required');
			const filterJsonString = specificData;

			let json;
			try {
				json = JSON.parse(filterJsonString);
			} catch (error) {
				console.warn('Json parse failed.');
				throw error;
			}

			filter = { ...json, since, until };

			break;

		case 'mention':
			if (!specificData) throw new Error('Mention public key is required');
			const mentionedpubkey = getHexPubKey(specificData);

			filter = {
				kinds,
				'#p': [mentionedpubkey],
				since,
				until,
			};

			break;

		case 'nip-04':
			if (!specificData) throw new Error('My public key is required for NIP-04 filter');
			const myPubkey = specificData;

			filter = {
				kinds: [4],
				'#p': [myPubkey],
				since,
				until,
			};

			break;

		default:
			console.warn('Invalid strategy provided.');
	}

	return filter;
}
