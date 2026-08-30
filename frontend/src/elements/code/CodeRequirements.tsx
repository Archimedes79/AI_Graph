import React, { useEffect, useState } from 'react';
import { getCodeEnv, installCodeRequirements, type CodeEnvStatus } from '../../utils/api';
import { errorText } from '../../utils/errorText';
import { ACCENT_TEXT, DANGER_TEXT, DIMMER, FIELD, MUTED, PRIMARY_BUTTON, SUCCESS } from '../../ui/theme';

interface CodeRequirementsProps {
  /** One requirement per line, as stored in `config.requirements`. */
  requirements: string[];
  onChange: (requirements: string[]) => void;
  language: string;
}

/**
 * What this code node needs installed.
 *
 * A code node can do almost anything, but only as far as it can import. Which
 * packages are available used to depend on which interpreter happened to run
 * it — the editor used the backend's own virtualenv, a built executable
 * whatever was on PATH — so the same graph behaved differently in the editor
 * and in the tool built from it, and a deploy bundle recorded nothing about
 * what its graph imported. Declaring them here fixes all three.
 *
 * Installing is a button rather than something Run does for you: it needs the
 * network and can take minutes.
 */
export default function CodeRequirements({ requirements, onChange, language }: CodeRequirementsProps) {
  const [env, setEnv] = useState<CodeEnvStatus | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    getCodeEnv().then(setEnv).catch(() => setEnv(null));
  }, []);

  if (language !== 'python') return null;

  const text = (requirements ?? []).join('\n');
  const hasAny = (requirements ?? []).length > 0;
  // `=== false` on purpose: while the status is still loading (or failed to
  // load) the button stays live rather than being greyed out on no evidence.
  const canInstall = env?.can_install !== false;

  const install = async () => {
    setInstalling(true);
    setMessage('');
    setFailed(false);
    try {
      const result = await installCodeRequirements(requirements);
      setEnv(result);
      setMessage(
        result.missing.length
          ? `Installed, but still missing: ${result.missing.join(', ')}`
          : `Installed ${result.installed.join(', ')}.`,
      );
      setFailed(result.missing.length > 0);
    } catch (e) {
      setMessage(errorText(e, 'Install failed.'));
      setFailed(true);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: MUTED }}>
          Packages this node needs (one per line, e.g. <code>pandas&gt;=2.0</code>)
        </label>
        <button
          onClick={install}
          disabled={installing || !hasAny || !canInstall}
          className="text-xs px-2 py-1 rounded"
          style={{ ...PRIMARY_BUTTON, opacity: installing || !hasAny || !canInstall ? 0.5 : 1 }}
          title={canInstall
            ? 'Install these into the environment code nodes run in'
            : 'This build ships a Python without pip; install Python from python.org to add packages'}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>
      <textarea
        className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
        style={{ ...FIELD, minHeight: 60 }}
        value={text}
        onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
        placeholder={'pandas>=2.0\npillow'}
        spellCheck={false}
      />
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        Only the standard library is available until you list something here. What you list
        travels with the graph and is written into a deploy bundle&apos;s requirements.txt.
        {env && (
          <>
            {' '}Installed into <span className="font-mono">{env.env_dir}</span>
            {env.env_exists ? '' : ' (created on first install)'}.
          </>
        )}
      </p>
      {env && !env.has_interpreter && (
        <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
          No Python interpreter was found, so Python code nodes cannot run here at all.
          Install Python from python.org and make sure it is on PATH — the Microsoft Store
          stub Windows puts there does not count.
        </p>
      )}
      {env && env.has_interpreter && !env.can_install && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Code nodes are running on the Python shipped inside this build, which has the
          standard library but no pip — so nothing can be installed for them. Install
          Python from python.org and put it on PATH to use the packages above.
        </p>
      )}
      {message && (
        <p className="text-xs mt-1" style={{ color: failed ? DANGER_TEXT : SUCCESS }}>{message}</p>
      )}
    </div>
  );
}
