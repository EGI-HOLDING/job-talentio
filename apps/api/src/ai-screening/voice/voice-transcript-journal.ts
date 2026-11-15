import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { NativeProgress } from './voice-native';

export type TranscriptDelta = { eventId: string; speaker: string; text: string; startMs: number; endMs: number };
type ClosureReceipt = {
    billedVoiceMs: number;
    closeReason?: string;
    playback?: Pick<NativeProgress, 'nativeDelivery' | 'captureGaps'>;
    transcriptTail?: TranscriptDelta[];
};
const maxCharactersPerBatch = 4_100_000;

export class VoiceTranscriptJournal {
    constructor(private readonly directory: string) {}

    private file(id: string, suffix = '.jsonl') {
        if (!/^[a-z0-9-]{1,80}$/iu.test(id)) throw new Error('VOICE_JOURNAL_INVALID_ID');
        return resolve(this.directory, id + suffix);
    }

    async append(id: string, fragments: readonly TranscriptDelta[]) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const fd = await open(this.file(id), 'a+', 0o600);
        try {
            const { size } = await fd.stat();
            const tail = Buffer.alloc(1);
            if (size) await fd.read(tail, 0, 1, size - 1);
            // A previous process may have stopped mid-line. Keep that record
            // separate so the reader can retain subsequent complete batches.
            await fd.appendFile((size && tail[0] !== 10 ? '\n' : '') + JSON.stringify(fragments) + '\n', 'utf8');
            await fd.sync();
        } finally { await fd.close(); }
    }

    async batches(id: string) {
        const source = await readFile(this.file(id), 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return '';
        });
        // Retain complete batches if the process stopped midway through its last append.
        let gap = false;
        const rows: TranscriptDelta[][] = [];
        for (const line of source.split('\n')) {
            if (!line) continue;
            try {
                if (line.length > maxCharactersPerBatch) throw new Error('VOICE_JOURNAL_OVERSIZE');
                const batch = JSON.parse(line) as TranscriptDelta[];
                if (!Array.isArray(batch)) throw new Error('VOICE_JOURNAL_MALFORMED');
                rows.push(batch);
            } catch { gap = true; }
        }
        return { rows, gap };
    }

    private async writeRecord(id: string, suffix: '.closed' | '.provider', value: unknown) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const temporary = this.file(id, suffix + '-' + randomUUID() + '.tmp');
        try {
            const fd = await open(temporary, 'wx', 0o600);
            try { await fd.writeFile(JSON.stringify(value), 'utf8'); await fd.sync(); }
            finally { await fd.close(); }
            await rename(temporary, this.file(id, suffix));
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    }

    private async readRecord(id: string, suffix: '.closed' | '.provider') {
        const saved = await readFile(this.file(id, suffix), 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return '';
        });
        if (!saved) return undefined;
        try { return JSON.parse(saved) as unknown; }
        catch { return undefined; }
    }

    recordProviderId(id: string, providerId: string) {
        return this.writeRecord(id, '.provider', providerId);
    }

    async readProviderId(id: string) {
        const value = await this.readRecord(id, '.provider');
        return typeof value === 'string' && value ? value : undefined;
    }

    recordClosure(id: string, receipt: ClosureReceipt) {
        return this.writeRecord(id, '.closed', receipt);
    }

    async readClosure(id: string) {
        const value = await this.readRecord(id, '.closed') as number | ClosureReceipt | null | undefined;
        const receipt = typeof value === 'number' ? { billedVoiceMs: value } : value;
        if (receipt && Number.isSafeInteger(receipt.billedVoiceMs) && receipt.billedVoiceMs >= 0) return receipt;
    }

    async ids() {
        const names = await readdir(this.directory).catch(error => {
            if (error.code !== 'ENOENT') throw error;
            return [] as string[];
        });
        return [...new Set(names.filter(name => /^[a-z0-9-]{1,80}\.(?:jsonl|closed|provider)$/iu.test(name))
            .map(name => name.slice(0, name.lastIndexOf('.'))))];
    }

    async remove(id: string, suffix: '.jsonl' | '.closed' | '.provider' = '.jsonl') {
        await unlink(this.file(id, suffix)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}
