import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Check, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { fetchVault } from '../../lib/identityVault';
import { buildBackup, downloadBackup, parseBackup } from '../../lib/identityBackup';
import { importIdentityFromBackup } from '../../lib/semaphore';

/**
 * The voter's own copy of their sealed identity, out and back in.
 *
 * The vault lives on chain, so losing this server no longer locks anyone out.
 * This covers the case the chain does not: an RPC nobody can reach, an entry
 * that was removed, or simply wanting the thing in your own hands rather than
 * in anyone's system. Same ciphertext, no third party in the path.
 *
 * The file is deliberately NOT treated as a secret to be hidden, and the copy
 * says so: it is sealed under a key derived from the passkey's PRF output, so
 * without the authenticator it opens nothing. Telling a voter to guard it like
 * a seed phrase would be both wrong and the kind of warning that makes people
 * skip the backup entirely.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'exported'; filename: string }
  | { kind: 'imported' }
  | { kind: 'error'; message: string };

export function IdentityBackupCard() {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const exportBackup = async () => {
    setStatus({ kind: 'working' });
    try {
      const vault = await fetchVault();
      if (!vault?.commitment) throw new Error(t('backup.no_identity'));
      const filename = downloadBackup(buildBackup(vault));
      setStatus({ kind: 'exported', filename });
    } catch (error: unknown) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const importBackup = async (file: File) => {
    setStatus({ kind: 'working' });
    try {
      const backup = parseBackup(await file.text());
      // The passkey prompt is the point of the import: the file alone proves
      // nothing and opens nothing.
      await importIdentityFromBackup(backup.entries, backup.commitment);
      setStatus({ kind: 'imported' });
    } catch (error: unknown) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Card className="p-5 mb-4">
      <h2 className="text-sm font-semibold text-on-surface mb-1">{t('backup.title')}</h2>
      <p className="text-xs text-on-surface-meta leading-relaxed mb-4">{t('backup.desc')}</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          variant="default"
          className="rounded-full gap-2 flex-1"
          onClick={() => void exportBackup()}
          disabled={status.kind === 'working'}
        >
          <Download className="w-4 h-4" />
          {t('backup.export')}
        </Button>
        <Button
          variant="ghost"
          className="rounded-full gap-2 flex-1"
          onClick={() => fileInput.current?.click()}
          disabled={status.kind === 'working'}
        >
          <Upload className="w-4 h-4" />
          {t('backup.import')}
        </Button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file twice fires the change again,
          // which is what a voter does after a failed first attempt.
          e.target.value = '';
          if (file) void importBackup(file);
        }}
      />

      {status.kind === 'exported' && (
        <p className="flex items-start gap-2 mt-3 text-xs text-success">
          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{t('backup.exported', { filename: status.filename })}</span>
        </p>
      )}
      {status.kind === 'imported' && (
        <p className="flex items-center gap-2 mt-3 text-xs text-success">
          <Check className="w-3.5 h-3.5 shrink-0" />
          {t('backup.imported')}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="flex items-start gap-2 mt-3 text-xs text-error">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{status.message}</span>
        </p>
      )}
    </Card>
  );
}
