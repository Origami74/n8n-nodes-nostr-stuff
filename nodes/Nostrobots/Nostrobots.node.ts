import { IExecuteFunctions } from 'n8n-core';
import {
	assert,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { hexToBytes } from '@noble/hashes/utils';
import ws from 'ws';
import { finalizeEvent, nip04 } from 'nostr-tools';
import { defaultRelays } from '../../src/constants/rerays';
import { getHex, getHexPubKey } from '../../src/convert/get-hex';
import { parseRelayInput, publishEvent } from '../../src/services/applesauce';

// polyfills
(global as any).WebSocket = ws;

// Timeout(millisecond).
const EVENT_POST_TIMEOUT = 10000;

export class Nostrobots implements INodeType {
	description: INodeTypeDescription = {
		// Basic node details will go here
		displayName: 'Nostr Write',
		name: 'nostrobots',
		icon: 'file:nostrobots.svg',
		group: ['transform'],
		version: 1,
		description: 'Consume Nostr API',
		defaults: {
			name: 'Nostr Write',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'nostrobotsApi',
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				options: [
					{
						name: 'BasicNote',
						value: 'kind1',
					},
					{
						name: 'Custom Event',
						value: 'customEvent',
					},
					{
						name: 'Encrypted Direct Message(nip-04)',
						value: 'nip-04',
					},
					{
						name: 'Event(advanced)',
						value: 'event',
					},
					{
						name: 'Raw Json Event(advanced)',
						value: 'json',
					},
				],
				default: 'kind1',
				noDataExpression: true,
				required: true,
				description: 'Create a new note',
			},
			{
				displayName:
					'NIP-04 does not go anywhere near what is considered the state-of-the-art in encrypted communication between peers, and it leaks metadata in the events. Use only if you do not have a problem with the sender and receiver information being divulged.',
				name: 'nip04hints',
				type: 'notice',
				displayOptions: {
					show: {
						resource: ['nip-04'],
					},
				},
				default: '',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				displayOptions: {
					show: {
						resource: ['event', 'kind1', 'json', 'nip-04', 'customEvent'],
					},
				},
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send a event',
						action: 'Send a event',
					},
				],
				default: 'send',
				noDataExpression: true,
			},
			// custom event option
			{
				displayName: 'Custom Event JSON',
				name: 'customEventJson',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['customEvent'],
					},
				},
				default: '{"kind": 1, "content": "Hello Nostr!", "tags": []}',
				placeholder: '{"kind": 1, "content": "...", "tags": [...]}',
				description: 'Complete custom Nostr event as JSON. Will be signed automatically.',
				hint: 'Provide kind, content, and tags. The event will be signed with your credentials.',
			},
			// common option
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['kind1', 'event', 'nip-04'],
					},
				},
				default: '',
				placeholder: 'your note.',
				description: 'Note here',
			},
			// event options
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'number',
				required: true,
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['event'],
					},
				},
				default: 1,
				placeholder: 'kind number',
				description: 'Event Kinds https://github.com/nostr-protocol/nips#event-kinds',
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['event'],
					},
				},
				/**
				 * Mention Sample
				 * [["e","dad5a4164747e4d88a45635c27a8b4ef632ebdb78dcd6ef3d12202edcabe1592","","root"],
				 * ["e","dad5a4164747e4d88a45635c27a8b4ef632ebdb78dcd6ef3d12202edcabe1592","","reply"],
				 * ["p","26bb2ebed6c552d670c804b0d655267b3c662b21e026d6e48ac93a6070530958"],
				 * ["p","26bb2ebed6c552d670c804b0d655267b3c662b21e026d6e48ac93a6070530958"]]
				 */
				default: '[]',
				placeholder: 'tags json string',
				description: 'Tags https://github.com/nostr-protocol/nips#standardized-tags',
			},
			// nip-04 option
			{
				displayName: 'SendTo',
				name: 'sendTo',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['nip-04'],
					},
				},
				default: '',
				placeholder: 'recipient public key',
				description: 'Hex or npub',
			},
			// other option
			{
				displayName: 'ShowOtherOption',
				name: 'otherOption',
				type: 'boolean',
				description:
					'Whether to set other options. If no other options are set, it will be calculated automatically.',
				default: false,
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['event'],
					},
				},
			},
			{
				displayName: 'EventId',
				name: 'eventID',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						otherOption: [true],
					},
				},
				default: '',
				placeholder: 'event ID',
				description: 'Hex event ID from raw event or calculate yourself',
			},
			{
				displayName: 'Pubkey',
				name: 'pubkey',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						otherOption: [true],
					},
				},
				default: '',
				placeholder: 'public key',
				description: 'Hex public key',
			},
			{
				displayName: 'Sig',
				name: 'sig',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						otherOption: [true],
					},
				},
				default: '',
				placeholder: 'signature string',
				description: 'Signature string of the event',
			},
			{
				displayName: 'CreatedAt',
				name: 'createdAt',
				type: 'number',
				required: true,
				displayOptions: {
					show: {
						otherOption: [true],
					},
				},
				default: null,
				placeholder: '123456789',
				description: 'Unixtime',
			},
			// json
			{
				displayName: 'Json',
				name: 'jsonEvent',
				type: 'json',
				required: true,
				displayOptions: {
					show: {
						resource: ['json'],
					},
				},
				default: '',
				placeholder: '{{ $json }}',
				description: 'Raw JSON event',
			},
			// relays
			{
				displayName: 'Custom Relay',
				name: 'relay',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['event', 'kind1', 'json', 'nip-04', 'customEvent'],
					},
				},
				default: JSON.stringify(defaultRelays),
				placeholder: '["wss://relay.damus.io", "wss://nostr.wine"]',
				description: 'Relay addresses as JSON array or comma-separated string',
				hint: 'Supports both JSON array format ["wss://..."] and comma-separated format',
			},
			{
				displayName: 'Minimum Successful Relays',
				name: 'minSuccessfulRelays',
				type: 'number',
				displayOptions: {
					show: {
						operation: ['send'],
						resource: ['event', 'kind1', 'json', 'nip-04', 'customEvent'],
					},
				},
				default: 1,
				description: 'Minimum number of relays that must successfully receive the event',
				hint: 'Set to 0 to not require any successful publishes (not recommended)',
			},
		],
	};
	// The execute method will go here
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Handle data coming from previous nodes
		const items = this.getInputData();
		const returnData = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const { secKey } = await this.getCredentials('nostrobotsApi');

		if (typeof secKey !== 'string') {
			throw new NodeOperationError(this.getNode(), 'Invalid secret key was provided!');
		}

		/**
		 * Get secret key and public key.
		 */
		let sk: Uint8Array;
		if (secKey.startsWith('nsec')) {
			// Convert to hex
			// emit 'Ox' and convert lower case.
			sk = hexToBytes(getHex(secKey, 'nsec'));
		} else {
			sk = hexToBytes(secKey);
		}

		for (let i = 0; i < items.length; i++) {
			let otherOption = false;

			/**
			 * Prepare event.
			 */
			let event: any = { created_at: Math.floor(Date.now() / 1000) };
			if (resource === 'customEvent') {
				const customEventString = this.getNodeParameter('customEventJson', i) as string;
				try {
					const customEventData = JSON.parse(customEventString);
					event = {
						...customEventData,
						created_at: customEventData.created_at || Math.floor(Date.now() / 1000),
					};
				} catch (error) {
					throw new NodeOperationError(this.getNode(), 'Invalid custom event JSON was provided!');
				}
			} else if (resource === 'kind1') {
				event.content = this.getNodeParameter('content', i) as string;
				event.kind = 1;
				event.tags = [];
			} else if (resource === 'nip-04') {
				const content = this.getNodeParameter('content', i) as string;
				const sendTo = this.getNodeParameter('sendTo', i) as string;
				const theirPublicKey = getHexPubKey(sendTo);
				event.kind = 4;
				event.tags = [['p', theirPublicKey]];
				event.content = await nip04.encrypt(sk, theirPublicKey, content);
			} else if (resource === 'event') {
				otherOption = this.getNodeParameter('otherOption', i) as boolean;
				event.content = this.getNodeParameter('content', i) as string;
				event.kind = this.getNodeParameter('kind', i) as number;
				const rawTags = this.getNodeParameter('tags', i) as string;
				let tags: [][];

				try {
					tags = Array.isArray(rawTags) ? rawTags : JSON.parse(rawTags);
					assert(Array.isArray(tags), 'Tags should be Array');
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						'Invalid tags was provided! Tags should be valid array',
					);
				}

				event.tags = tags;
				if (otherOption) {
					event.id = this.getNodeParameter('eventID', i) as string;
					event.pubkey = this.getNodeParameter('pubkey', i) as string;
					event.sig = this.getNodeParameter('sig', i) as string;
					event.created_at = this.getNodeParameter('createdAt', i) as string;
				}
			} else if (resource === 'json') {
				const eventString = this.getNodeParameter('jsonEvent', i) as string;

				try {
					event = JSON.parse(eventString);
				} catch (error) {
					console.warn('Json parse failed.');
					throw new NodeOperationError(this.getNode(), error);
				}
			} else {
				throw new NodeOperationError(this.getNode(), 'Invalid resource was provided!');
			}

			/**
			 * Execute Operation.
			 */
			if (operation === 'send') {
				// Get relay input and parse it (supports both JSON array and comma-separated)
				const relays = this.getNodeParameter('relay', i) as string;
				const relayArray = parseRelayInput(relays);
				const minSuccessfulRelays = this.getNodeParameter('minSuccessfulRelays', i) as number;

				// Sign Event.
				const signedEvent = !otherOption && resource !== 'json' ? finalizeEvent(event, sk) : event;

				// Post event to relays using applesauce.
				const results = await publishEvent(signedEvent, relayArray, EVENT_POST_TIMEOUT);

				// Check if we met the minimum success threshold
				const successCount = results.filter((r) => r.success).length;
				if (successCount < minSuccessfulRelays) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to publish to minimum required relays. Required: ${minSuccessfulRelays}, Successful: ${successCount}/${relayArray.length}`,
					);
				}

				// Return result.
				returnData.push({
					event: signedEvent,
					sendResults: results,
					successCount,
					totalRelays: relayArray.length,
				});
			}
		}

		// Map data to n8n data structure
		return [this.helpers.returnJsonArray(returnData)];
	}
}
