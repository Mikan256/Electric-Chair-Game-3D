import './room-entry.css';
import {
  normalizeRoomId,
  ROOM_ID_MAX_LENGTH,
  ROOM_ID_MIN_LENGTH,
  sanitizeRoomIdInput,
} from './room-id';

export { normalizeRoomId } from './room-id';

export interface RoomEntryOptions {
  onCreate: () => void;
  onJoin: (roomId: string) => void;
  onBack?: () => void;
  initialRoomId?: string;
  busy?: boolean;
  error?: string | null;
}

const HINT_DEFAULT = `${ROOM_ID_MIN_LENGTH}〜${ROOM_ID_MAX_LENGTH}文字の英数字・ハイフン・アンダースコア`;
const HINT_TOO_SHORT = `${ROOM_ID_MIN_LENGTH}文字以上入力してください`;
const HINT_READY = 'Enter でも参加できます';

const TEMPLATE = `
  <div class="panel room-entry-panel">
    <div class="room-entry-head">
      <h2 id="room-entry-title">ONLINE MATCH</h2>
      <p class="room-entry-lead">
        ルームを作成するか、友だちから共有されたルームIDで参加
      </p>
    </div>
    <button class="btn primary room-entry-create" id="btn-create-room" type="button">
      ルームを作成
    </button>
    <div class="room-entry-divider"><span>または</span></div>
    <form class="room-entry-join" id="room-entry-form" novalidate>
      <label class="room-entry-label" for="room-id-input">ルームID</label>
      <div class="room-entry-field">
        <input
          class="room-entry-input"
          id="room-id-input"
          type="text"
          placeholder="ROOM ID"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          maxlength="${ROOM_ID_MAX_LENGTH}"
          inputmode="text"
          aria-label="ルームID"
          aria-describedby="room-id-hint"
        />
        <button class="btn primary room-entry-join-btn" id="btn-join-room" type="submit" disabled>
          参加
        </button>
      </div>
      <p class="room-entry-hint" id="room-id-hint">${HINT_DEFAULT}</p>
    </form>
    <div class="room-entry-error" id="room-entry-error" role="alert" hidden></div>
    <div class="room-entry-actions">
      <button class="btn ghost room-entry-back" id="btn-room-back" type="button">戻る</button>
    </div>
  </div>
`;

/**
 * 「ルームIDで参加」画面。既存の GameUI から独立しており、
 * `element` を任意のホストへ append して使う。
 */
export class RoomEntry {
  readonly element: HTMLElement;

  private readonly options: RoomEntryOptions;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly createButton: HTMLButtonElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly backButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly abort = new AbortController();
  private busy = false;
  private destroyed = false;

  constructor(options: RoomEntryOptions) {
    this.options = options;

    this.element = document.createElement('div');
    this.element.className = 'room-entry';
    this.element.innerHTML = TEMPLATE;

    const query = <T extends Element>(selector: string): T => {
      const found = this.element.querySelector<T>(selector);
      if (!found) throw new Error(`RoomEntry: missing ${selector}`);
      return found;
    };

    this.form = query<HTMLFormElement>('#room-entry-form');
    this.input = query<HTMLInputElement>('#room-id-input');
    this.createButton = query<HTMLButtonElement>('#btn-create-room');
    this.joinButton = query<HTMLButtonElement>('#btn-join-room');
    this.backButton = query<HTMLButtonElement>('#btn-room-back');
    this.hint = query<HTMLElement>('#room-id-hint');
    this.errorBox = query<HTMLElement>('#room-entry-error');

    if (this.options.initialRoomId) {
      this.input.value = sanitizeRoomIdInput(this.options.initialRoomId);
    }
    if (!this.options.onBack) {
      this.backButton.remove();
    }

    const { signal } = this.abort;
    this.input.addEventListener('input', () => this.handleInput(), { signal });
    this.form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault();
        this.submitJoin();
      },
      { signal },
    );
    this.createButton.addEventListener(
      'click',
      () => {
        if (this.busy) return;
        this.options.onCreate();
      },
      { signal },
    );
    this.backButton.addEventListener(
      'click',
      () => {
        if (this.busy) return;
        this.options.onBack?.();
      },
      { signal },
    );

    this.setBusy(this.options.busy ?? false);
    this.setError(this.options.error ?? null);
    this.updateJoinState();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.element.classList.toggle('is-busy', busy);
    this.element.setAttribute('aria-busy', busy ? 'true' : 'false');
    this.input.disabled = busy;
    this.createButton.disabled = busy;
    this.backButton.disabled = busy;
    this.joinButton.textContent = busy ? '接続中…' : '参加';
    this.updateJoinState();
  }

  setError(error: string | null): void {
    const message = error?.trim() ?? '';
    this.errorBox.textContent = message;
    this.errorBox.hidden = message.length === 0;
    this.element.classList.toggle('has-error', message.length > 0);
    if (message.length === 0 || this.busy) return;
    // 画面内にフォーカスがある場合だけ入力欄へ戻す（外のフォーカスは奪わない）。
    const active = document.activeElement;
    if (active instanceof Node && this.element.contains(active)) {
      this.input.focus();
    }
  }

  focus(): void {
    if (this.destroyed) return;
    this.input.focus();
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    this.element.remove();
  }

  private handleInput(): void {
    const raw = this.input.value;
    const caret = this.input.selectionStart ?? raw.length;
    const cleanedBefore = sanitizeRoomIdInput(raw.slice(0, caret));
    const cleaned = sanitizeRoomIdInput(raw);
    if (cleaned !== raw) {
      this.input.value = cleaned;
      const position = Math.min(cleanedBefore.length, cleaned.length);
      this.input.setSelectionRange(position, position);
    }
    this.updateJoinState();
  }

  private updateJoinState(): void {
    const normalized = normalizeRoomId(this.input.value);
    const trimmed = this.input.value.trim();
    const valid = normalized !== null;

    this.joinButton.disabled = this.busy || !valid;
    this.input.setAttribute('aria-invalid', trimmed.length > 0 && !valid ? 'true' : 'false');

    this.hint.classList.toggle('is-invalid', trimmed.length > 0 && !valid);
    if (trimmed.length === 0) {
      this.hint.textContent = HINT_DEFAULT;
    } else if (!valid && trimmed.length < ROOM_ID_MIN_LENGTH) {
      this.hint.textContent = HINT_TOO_SHORT;
    } else if (valid) {
      this.hint.textContent = HINT_READY;
    } else {
      this.hint.textContent = HINT_DEFAULT;
    }
  }

  private submitJoin(): void {
    if (this.busy) return;
    const roomId = normalizeRoomId(this.input.value);
    if (roomId === null) {
      this.setError(
        `ルームIDは${ROOM_ID_MIN_LENGTH}〜${ROOM_ID_MAX_LENGTH}文字の` +
          '英数字・ハイフン・アンダースコアで入力してください',
      );
      this.input.focus();
      return;
    }
    this.input.value = roomId;
    this.updateJoinState();
    this.options.onJoin(roomId);
  }
}
