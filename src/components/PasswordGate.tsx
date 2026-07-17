/**
 * PasswordGate — a soft access gate shown before the app.
 *
 * NOTE ON SECURITY: this is a client-side gate only. A static SPA ships all its
 * code to the browser, so a determined visitor can bypass it (the compare runs
 * in JS). It keeps casual viewers out and gives the demo a "credentialed" feel;
 * it is NOT real authentication. For that, put the app behind a server that
 * checks credentials before serving the bundle (e.g. Vercel deployment
 * protection or an auth proxy). The passcode is stored as a hash so the literal
 * string is not sitting in the bundle as plaintext.
 */
import { KeyRound, Lock } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** djb2 hash of the passcode — the literal never appears in source. */
const PASSCODE_HASH = 3125735235;
const UNLOCK_KEY = 'triage.unlocked';

function djb2(s: string): number {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0;
  return x;
}

export default function PasswordGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(UNLOCK_KEY) === '1',
  );
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!unlocked) inputRef.current?.focus();
  }, [unlocked]);

  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (djb2(value) === PASSCODE_HASH) {
      try {
        sessionStorage.setItem(UNLOCK_KEY, '1');
      } catch {
        /* private-mode / storage disabled — unlock for this render anyway */
      }
      setUnlocked(true);
    } else {
      setError(true);
      setValue('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900/40 p-8 shadow-2xl"
      >
        <div className="mb-6 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/60 text-sky-400">
            <Lock size={20} />
          </div>
          <h1 className="font-mono text-lg font-bold tracking-[0.28em] text-slate-100">TRIAGE</h1>
          <p className="mt-1 text-[10px] leading-tight tracking-wide text-slate-500">
            Telemetry Root-cause Inference And Guided Evaluation
          </p>
        </div>

        <label
          htmlFor="triage-passcode"
          className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate-400"
        >
          Passcode
        </label>
        <input
          ref={inputRef}
          id="triage-passcode"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          aria-invalid={error}
          className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500/60"
          placeholder="enter passcode to continue"
        />

        {error && (
          <p className="mt-2 font-mono text-[11px] text-red-400">Incorrect passcode — try again.</p>
        )}

        <button
          type="submit"
          className="mt-5 flex w-full items-center justify-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition-colors hover:bg-sky-500/20"
        >
          <KeyRound size={13} /> Unlock
        </button>

        <p className="mt-6 border-t border-slate-800/60 pt-3 text-center text-[10px] leading-snug text-slate-600">
          Restricted access · anomaly review console
        </p>
      </form>
    </div>
  );
}
