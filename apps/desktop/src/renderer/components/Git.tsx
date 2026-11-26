import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, FileText, GitBranch, GitCommitHorizontal, GitFork, Minus, Plus, RefreshCw } from 'lucide-react';
import { isGitAction, isGitCloneRequest } from '@factory/contracts';
import type { GitAction, GitArea, GitCloneRequest, GitDiff, GitOutcome, GitRepository, OpenProject } from '@factory/contracts';
import { gitBridge, gitLabel } from '../useGit';
import type { useGit } from '../useGit';
import { Button, Dialog, IconButton, Input } from './Controls';

type ActionInput = GitAction extends infer Action ? Action extends GitAction ? Omit<Action, 'id' | 'revision'> : never : never;
type Inspection = { title: string; diff?: GitDiff; error?: string; pending?: boolean };

const compactRef = (ref: string) => ref.replace(/^refs\/(?:heads|remotes)\//u, '');
const changeNames: Record<string, string> = {
  A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflict', '?': 'Untracked',
};

export function CloneDialog({ close, clone, busy }: {
  close: () => void;
  clone: (input: GitCloneRequest) => void;
  busy: boolean;
}) {
  const [source, setSource] = useState<'https' | 'local'>('https');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const input: GitCloneRequest = source === 'https' ? { source, url: url.trim(), name: name.trim() } : { source, name: name.trim() };
  return (
    <Dialog title="Clone Repository" onClose={() => { if (!busy) close(); }}>
      <form className="git-form" onSubmit={(event) => { event.preventDefault(); if (isGitCloneRequest(input) && !busy) clone(input); }}>
        <label>Source<select value={source} onChange={(event) => setSource(event.target.value === 'local' ? 'local' : 'https')} disabled={busy}>
          <option value="https">Public HTTPS URL</option>
          <option value="local">Local bare Git repository</option>
        </select></label>
        {source === 'https' && <label>Repository URL<Input autoFocus type="url" value={url} placeholder="https://github.com/owner/project.git"
          maxLength={2048} onChange={(event) => setUrl(event.target.value)} required disabled={busy} /></label>}
        <label>New folder name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={busy} /></label>
        <p className="muted">Choose the parent folder in the native dialog, then review the destination before cloning.</p>
        <div className="dialog-actions">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!isGitCloneRequest(input) || busy}>{busy ? 'Cloning…' : 'Choose Folders'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function StatusMessage({ result }: { result: Pick<GitOutcome, 'level' | 'message'> }) {
  return <p className={`git-message git-message--${result.level}`} role={result.level === 'error' ? 'alert' : 'status'}>
    {result.level === 'error' && <CircleAlert size={15} aria-hidden="true" />}{result.message}
  </p>;
}

function Patch({ inspection }: { inspection: Inspection | null }) {
  return <section className="git-diff" aria-labelledby="diff-title">
    <h2 id="diff-title">{inspection?.title ?? 'Diff'}</h2>
    {!inspection ? <p className="git-empty"><FileText size={17} aria-hidden="true" />Select a changed file or inspect a branch.</p>
      : inspection.pending ? <p className="git-empty" role="status">Reading diff…</p>
        : inspection.error ? <p className="git-empty" role="alert">{inspection.error}</p>
          : inspection.diff?.text ? <>
            {inspection.diff.truncated && <p className="git-message git-message--warning">Diff reached the display limit. Inspect the full diff in your Git client.</p>}
            <pre tabIndex={0} aria-label="Git patch"><code>{inspection.diff.text.split('\n').map((line, index) => {
              const tone = line.startsWith('@@') ? 'hunk' : /^\+(?!\+\+)/u.test(line) ? 'add'
                : /^-(?!--)/u.test(line) ? 'remove' : undefined;
              return <span key={index} data-tone={tone}>{line}{'\n'}</span>;
            })}</code></pre>
          </> : <p className="git-empty">No content differences.</p>}
  </section>;
}

function Changes({ repository, area, selected, choose, busy, request }: {
  repository: GitRepository;
  area: GitArea;
  selected: string | null;
  choose: (row: number, area: GitArea) => void;
  busy: boolean;
  request: (operation: ActionInput) => void;
}) {
  const staged = area === 'staged';
  const entries = repository.changes.flatMap((change, row) => {
    const code = staged ? change.index : change.worktree;
    return code === '.' || (staged && code === '?') ? [] : [{ change, row, code }];
  });
  return <section className="git-changes" aria-label={staged ? 'Staged changes' : 'Working changes'}>
    <h2>{staged ? 'Staged changes' : 'Working changes'}<span>{entries.length}</span></h2>
    {entries.length ? <ul>{entries.map(({ change, row, code }) => {
      const label = change.original ? `${change.original} → ${change.path}` : change.path;
      return <li className="git-change" key={row}>
        <Button className="git-file" title={label} aria-pressed={selected === `${area}-${row}`} onClick={() => choose(row, area)} disabled={busy}>
          <span className={`git-change-code git-change-code--${code}`} title={changeNames[code]} aria-label={changeNames[code]}>{code}</span>
          <bdi>{label}</bdi>
        </Button>
        <IconButton label={`${staged ? 'Unstage' : 'Stage'} ${change.path}`} disabled={busy || !change.actionable || Boolean(repository.operation)}
          onClick={() => request({ operation: staged ? 'unstage' : 'stage', row })}>
          {staged ? <Minus size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        </IconButton>
      </li>;
    })}</ul> : <p className="git-empty">{staged ? 'Nothing staged.' : 'No working changes.'}</p>}
  </section>;
}

export function GitPanel({ project, git }: { project: OpenProject; git: ReturnType<typeof useGit> }) {
  const [inspected, setInspected] = useState<{ id: string; revision: string; key: string; value: Inspection } | null>(null);
  const [ref, setRef] = useState('');
  const [selectedRemote, setSelectedRemote] = useState('');
  const [message, setMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchDialog, setBranchDialog] = useState(false);
  const [dirtyDialog, setDirtyDialog] = useState(false);
  const [pending, setPending] = useState<GitAction['operation'] | null>(null);
  const [result, setResult] = useState<Pick<GitOutcome, 'level' | 'message'> | null>(null);
  const context = git.status;
  const repo = context?.state === 'repository' ? context : null;
  const busy = pending !== null;
  const target = repo?.branches.find((branch) => branch.ref === ref);
  const revision = repo?.revision ?? null;
  const activeInspection = inspected?.id === project.id && inspected.revision === revision ? inspected : null;
  const transfer = repo?.remotes.filter((remote) => remote.kind !== 'unsupported') ?? [];
  const remote = (transfer.some((item) => item.name === selectedRemote) ? selectedRemote : transfer[0]?.name) ?? '';
  const tracks = Boolean(repo?.upstreamRemote && transfer.some((item) => item.name === repo.upstreamRemote) && repo.head && repo.branch);

  async function request(input: ActionInput) {
    const action = { ...input, id: project.id, revision };
    if (busy || !isGitAction(action)) return;
    setPending(input.operation);
    setResult(null);
    try {
      const response = await git.action(action);
      if (response?.ok) {
        setResult(response.value);
        if (response.value.level === 'success' && input.operation === 'commit') setMessage('');
      } else {
        setResult({ level: 'error', message: response?.error === 'PROJECT_BUSY' ? 'Another Git action is already in progress.' : 'Studio could not run this Git action.' });
      }
    } catch {
      setResult({ level: 'error', message: 'Studio could not reach the desktop Git service.' });
    } finally {
      setPending(null);
    }
  }

  async function inspect(input: { row: number; area: GitArea } | { ref: string }) {
    if (!repo || !gitBridge) return;
    const base = { id: project.id, revision: repo.revision };
    const change = 'row' in input ? repo.changes[input.row] : undefined;
    const key = 'row' in input ? `${input.area}-${input.row}` : input.ref;
    const title = 'row' in input
      ? `${input.area === 'staged' ? 'Staged' : 'Working'} · ${change?.path ?? 'Diff'}`
      : `Compare HEAD and ${compactRef(input.ref)}`;
    setInspected({ ...base, key, value: { title, pending: true } });
    const apply = (value: Inspection) => {
      setInspected((current) => current?.key === key && current.revision === base.revision ? { ...base, key, value } : current);
    };
    try {
      const response = await ('row' in input ? gitBridge.diff({ ...base, ...input }) : gitBridge.compare({ ...base, ...input }));
      if (response.ok) apply({ title, diff: response.value });
      else {
        apply({ title, error: response.error === 'GIT_STALE' ? 'Repository changed. Refresh and select the updated item.' : 'This diff could not be displayed safely.' });
        if (response.error === 'GIT_STALE') void git.refresh();
      }
    } catch {
      apply({ title, error: 'Could not load the Git diff.' });
    }
  }

  function switchBranch() {
    if (!target || !target.ref.startsWith('refs/heads/')) return;
    if (repo?.changes.length) setDirtyDialog(true);
    else void request({ operation: 'switch', ref: target.ref });
  }

  let content: ReactNode;
  if (!repo) {
    content = <div className="git-blank">
      <GitFork size={21} aria-hidden="true" />
      <div>
        <h2>{project.availability !== 'ready' ? 'Project unavailable' : gitLabel(context)}</h2>
        <p>{project.availability !== 'ready' ? 'Locate the project folder from Overview.'
          : (context && 'detail' in context ? context.detail : null) ?? (gitBridge ? 'Reading the authorized project folder.' : 'Git Studio is available in the desktop app.')}</p>
        {context?.state === 'not-repository' && <Button variant="primary" onClick={() => void request({ operation: 'init' })} disabled={busy}>Initialize Repository</Button>}
      </div>
    </div>;
  } else {
    const disabled = busy || Boolean(repo.operation);
    const canSwitch = target?.ref.startsWith('refs/heads/') && compactRef(target.ref) !== repo.branch;
    const canCommit = repo.branch && repo.changes.some((change) => change.index !== '.' && change.index !== '?');
    content = <>
      <div className="git-refbar">
        <div><GitBranch size={16} aria-hidden="true" /><strong><bdi>{repo.branch ?? 'Detached HEAD'}</bdi></strong></div>
        <div><GitCommitHorizontal size={16} aria-hidden="true" /><code title={repo.head ?? undefined}>{repo.head?.slice(0, 12) ?? 'Unborn HEAD'}</code></div>
        <div className="git-tracking"><bdi>{repo.upstream ?? 'No upstream'}</bdi>{repo.upstream && <>
          <span aria-label={`${repo.ahead} commits ahead`} title={`${repo.ahead} commits ahead`}><ArrowUp size={13} aria-hidden="true" />{repo.ahead}</span>
          <span aria-label={`${repo.behind} commits behind`} title={`${repo.behind} commits behind`}><ArrowDown size={13} aria-hidden="true" />{repo.behind}</span>
        </>}</div>
        <strong className="git-tree-state">{gitLabel(repo)}</strong>
      </div>
      <div className="git-tools">
        <div className="git-branch-controls" role="group" aria-label="Branch actions">
          <select aria-label="Branch" value={target?.ref ?? ''} disabled={busy} onChange={(event) => setRef(event.target.value)}>
            <option value="">Select branch…</option>
            {(['heads', 'remotes'] as const).map((group) => <optgroup key={group} label={group === 'heads' ? 'Local branches' : 'Remote branches'}>
              {repo.branches.filter((branch) => branch.ref.startsWith(`refs/${group}/`)).map((branch) => (
                <option key={branch.ref} value={branch.ref}>{compactRef(branch.ref)}</option>
              ))}
            </optgroup>)}
          </select>
          <Button className="outlined-button" onClick={() => target && void inspect({ ref: target.ref })} disabled={busy || !target || !repo.head}>Compare</Button>
          <Button className="outlined-button" onClick={switchBranch} disabled={disabled || !canSwitch}>Switch</Button>
          <IconButton label="Create branch" onClick={() => setBranchDialog(true)} disabled={disabled || !repo.head}><Plus size={16} aria-hidden="true" /></IconButton>
        </div>
        <div className="git-remote-controls" role="group" aria-label="Remote actions">
          {transfer.length > 1 && <select aria-label="Fetch remote" value={remote} onChange={(event) => setSelectedRemote(event.target.value)} disabled={busy}>
            {transfer.map((entry) => <option key={entry.name}>{entry.name}</option>)}
          </select>}
          <Button className="outlined-button" disabled={disabled || !remote} onClick={() => void request({ operation: 'fetch', remote })}>Fetch</Button>
          <Button className="outlined-button" disabled={disabled || !tracks || repo.changes.length > 0} onClick={() => void request({ operation: 'pull' })}>Pull (FF)</Button>
          <Button className="outlined-button" disabled={disabled || !tracks} onClick={() => void request({ operation: 'push' })}>Push</Button>
        </div>
      </div>
      {repo.operation && <StatusMessage result={{ level: 'warning', message: `Git ${repo.operation} is in progress. Finish or abort it in your Git client. Studio has blocked changes.` }} />}
      {repo.ahead > 0 && repo.behind > 0 && <StatusMessage result={{ level: 'warning', message: 'Local and upstream history have diverged. Compare the upstream branch before reconciling in your Git client.' }} />}
      {repo.remotes.some((item) => item.kind === 'unsupported') && <p className="git-hint">Some remotes use transports outside Studio’s HTTPS and local bare repository policy.</p>}
      {repo.changes.length > 0 && tracks && <p className="git-hint">Fast-forward pull is available when the working tree is clean.</p>}
      <div className="git-split">
        <div className="git-files">
          <Changes repository={repo} area="working" selected={activeInspection?.key ?? null} choose={(row, area) => void inspect({ row, area })} busy={busy} request={(input) => void request(input)} />
          <Changes repository={repo} area="staged" selected={activeInspection?.key ?? null} choose={(row, area) => void inspect({ row, area })} busy={busy} request={(input) => void request(input)} />
          <form className="git-commit" onSubmit={(event) => { event.preventDefault(); void request({ operation: 'commit', message }); }}>
            <label htmlFor="commit-message">Commit message</label>
            <textarea id="commit-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={8000} rows={3} placeholder="Summarize the staged changes" disabled={busy} />
            <Button type="submit" variant="primary" disabled={disabled || !canCommit || !message.trim()}><GitCommitHorizontal size={15} aria-hidden="true" />Commit</Button>
          </form>
        </div>
        <Patch inspection={activeInspection?.value ?? null} />
      </div>
    </>;
  }
  return <div className="page git-page" aria-busy={busy}>
    <header className="page-header project-heading">
      <div><h1>Git Studio</h1><p className="project-path"><bdi>{repo?.root ?? project.directory}</bdi></p></div>
      <Button className="outlined-button" onClick={() => void git.refresh()} disabled={busy || !gitBridge || project.availability !== 'ready'}>
        <RefreshCw size={15} aria-hidden="true" />Refresh
      </Button>
    </header>
    {busy && <p className="git-message" role="status">Git operation in progress…</p>}
    {result && <StatusMessage result={result} />}
    {content}
    {branchDialog && <Dialog title="Create local branch" onClose={() => setBranchDialog(false)}>
      <form className="git-form" onSubmit={(event) => {
        event.preventDefault();
        setBranchDialog(false);
        void request({ operation: 'create', name: branchName });
      }}>
        <label>Branch name<Input autoFocus value={branchName} onChange={(event) => setBranchName(event.target.value)} maxLength={240} required /></label>
        <div className="dialog-actions">
          <Button onClick={() => setBranchDialog(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!isGitAction({ operation: 'create', id: project.id, revision, name: branchName })}>Review Branch</Button>
        </div>
      </form>
    </Dialog>}
    {dirtyDialog && <Dialog title="Checkout blocked" onClose={() => setDirtyDialog(false)}>
      <p className="confirm-copy">The working tree has staged, unstaged, or untracked changes. Keep your work in the current branch and review these paths.</p>
      <ul className="git-review">{repo?.changes.map((change) =>
        <li key={change.path}><code>{change.index}{change.worktree}</code><bdi>{change.path}</bdi></li>)}</ul>
      <div className="dialog-actions"><Button autoFocus onClick={() => setDirtyDialog(false)}>Cancel</Button></div>
    </Dialog>}
  </div>;
}
