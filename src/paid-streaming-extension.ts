import bencode from 'bencode';
import { Extension } from 'bittorrent-protocol';
import EventEmitter from 'eventemitter3';
import {
  ExtendedHandshake,
  PaidStreamingExtensionEvents,
  PaidStreamingExtensionNotices,
  PaidStreamingWire
} from './types';
import debug from 'debug';
const log = debug('web3torrent:extension');

export abstract class PaidStreamingExtension implements Extension {
  protected wire: PaidStreamingWire;
  protected messageBus: EventEmitter;
  protected _pseAccount: string = '';

  get name(): 'paidStreamingExtension' {
    return 'paidStreamingExtension';
  }

  peerAccount?: string;

  isForceChoking = false;

  constructor(wireToUse: PaidStreamingWire) {
    this.wire = wireToUse;
    this.messageBus = new EventEmitter();
    this.interceptRequests();
  }

  get pseAccount(): string {
    return this._pseAccount;
  }

  set pseAccount(value: string) {
    this._pseAccount = value;
    this.wire.extendedHandshake.pseAccount = value;
  }

  on(event: PaidStreamingExtensionEvents, callback: EventEmitter.ListenerFn<any[]>) {
    this.messageBus.on(event, callback);
  }

  once(event: PaidStreamingExtensionEvents, callback: EventEmitter.ListenerFn<any[]>) {
    this.messageBus.once(event, callback);
  }

  // tslint:disable-next-line: no-empty
  onHandshake(/* infoHash, peerId, extensions */) { }

  onExtendedHandshake(handshake: ExtendedHandshake) {
    if (!handshake.m || !handshake.m[this.name]) {
      log('WARNING: Peer does not support Web3Torrent')
      return this.messageBus.emit(
        PaidStreamingExtensionEvents.WARNING,
        new Error('!>Peer does not support Web3Torrent')
      );
    }

    if (handshake.pseAccount) {
      this.peerAccount = handshake.pseAccount.toString();
    }

    this.messageBus.emit(PaidStreamingExtensionEvents.PSE_HANDSHAKE, {
      pseAccount: this.peerAccount
    });

    return true;
  }

  stop() {
    this.isForceChoking = true;
    this.wire.choke();
    this.executeExtensionCommand(PaidStreamingExtensionNotices.STOP);
  }

  start() {
    this.isForceChoking = false;
    this.wire.unchoke();
    this.executeExtensionCommand(PaidStreamingExtensionNotices.START);
  }

  ack() {
    this.executeExtensionCommand(PaidStreamingExtensionNotices.ACK);
  }

  onMessage(buffer: Buffer) {
    try {
      const jsonData = bencode.decode(buffer, undefined, undefined, 'utf8');
      this.messageBus.emit(PaidStreamingExtensionEvents.NOTICE, jsonData);
    } catch (err) {
      log('ERROR: decoding', err);
      return;
    }
  }

  protected executeExtensionCommand(command: PaidStreamingExtensionNotices, data = {}) {
    this.wire.extended(this.name, bencode.encode({ msg_type: 0, command, data }));
  }

  protected interceptRequests() {
    // tslint:disable-next-line: no-string-literal
    const undecoratedOnRequestFunction = this.wire._onRequest;
    const extension = this;
    const { messageBus } = extension;
    const wire = this.wire as PaidStreamingWire;

    // tslint:disable-next-line: only-arrow-functions no-string-literal
    this.wire._onRequest = function(index: number, offset: number, length: number) {
      log(`!> Incoming request for piece - index ${arguments[0]}`);

      messageBus.emit(
        PaidStreamingExtensionEvents.REQUEST,
        wire.paidStreamingExtension && wire.paidStreamingExtension.peerAccount
      );

      // Call onRequest after the handlers triggered by this event have been called

      setTimeout(() => {
        if (!extension.isForceChoking) {
          undecoratedOnRequestFunction.apply(wire, [index, offset, length]);
        } else {
          log('!> dropped request - index: ' + index);
        }
      }, 0);
    };
  }
}
