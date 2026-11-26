import { useCallback, useEffect, useState } from 'react';
import { isGitReviewInput } from '@factory/contracts';
import type {
  GitAdvancedBridge, GitRepository, GitReview, GitReviewInput, GitScope, GitWorkspaceDetails, ProjectSelection,
} from '@factory/contracts';
import { Button, Dialog, Input } from './Controls';

type ReviewInput = GitReviewInput extends infer Value ? Value extends GitScope ? Omit<Value, keyof GitScope> : never : never;
type View = 'worktrees' | 'stashes' | 'integration' | 'conflicts';

export function GitAdvancedPanel({ bridge, id, repository, switchRef, clearSwitch, opened, refresh }: {
  bridge: GitAdvancedBridge; id: string; repository: GitRepository; switchRef: string | null;
  clearSwitch(): void; opened(selection: ProjectSelection): void; refresh(): Promise<void>;
}) {
  const { branches, branch, head, revision, operation } = repository;
  const [view, setView] = useState<View>('worktrees');
  const [open, setOpen] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [details, setDetails] = useState<GitWorkspaceDetails>();
  const [folder, setFolder] = useState('');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [stashMessage, setStashMessage] = useState('');
  const [untracked, setUntracked] = useState(false);
  const [kind, setKind] = useState<'merge' | 'rebase' | 'cherry-pick'>('merge');
  const [source, setSource] = useState('');
  const [commit, setCommit] = useState('');
  const [filePath, setFilePath] = useState('');
  const [rename, setRename] = useState('');
  const [strategy, setStrategy] = useState<'ff-only' | 'merge'>('ff-only');
  const [review, setReview] = useState<GitReview>();
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    if (!open && !operation) return;
    let live = true;
    function load() {
      void bridge.details({ id, revision }).then((reply) => {
        if (!live) return;
        setDetailsError(!reply.ok && reply.error !== 'GIT_STALE');
        if (reply.ok) setDetails(reply.value);
      }).catch(() => { if (live) { setDetails(undefined); setDetailsError(true); } });
    }
    load();
    const timer = window.setInterval(load, 6000);
    return () => { live = false; window.clearInterval(timer); };
  }, [bridge, epoch, id, open, operation, revision]);

  const start = useCallback(async (input: ReviewInput) => {
    const request = { id, revision, ...input };
    if (!isGitReviewInput(request)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const reply = await bridge.review(request);
      if (reply.ok) setReview(reply.value ?? undefined);
      else setNotice({ text: 'Git state changed or could not be inspected. Refresh and review again.', error: true });
    } catch { setNotice({ text: 'Studio could not reach the Git review service.', error: true }); }
    finally { setBusy(false); }
  }, [bridge, id, revision]);

  useEffect(() => {
    if (!switchRef) return;
    clearSwitch();
    void start({ kind: 'switch', ref: switchRef });
  }, [clearSwitch, start, switchRef]);

  async function apply() {
    if (!review?.ticket) return;
    setBusy(true);
    try {
      const result = await bridge.apply({ id, ticket: review.ticket });
      if (result.ok) {
        setNotice({ text: result.value.message, error: result.value.level === 'error' });
        if (result.value.selection) opened(result.value.selection);
      } else setNotice({ text: 'This review expired or the workspace is busy. Refresh before retrying.', error: true });
    } catch { setNotice({ text: 'Studio could not complete the reviewed Git operation.', error: true }); }
    finally {
      setReview(undefined);
      setBusy(false);
      setEpoch((value) => value + 1);
      await refresh();
    }
  }

  const show = (next: View) => { setOpen(true); setView(next); };
  const worktreeRef = worktreeBranch || (branch ? 'refs/heads/' + branch : '');
  const activeConflict = Boolean(operation || details?.conflicts.length);
  const locked = busy || activeConflict;
  const candidate = commit.trim() || source;
  const selection = kind === 'merge' ? { kind, source: candidate, strategy } as const : { kind, source: candidate };
  const options = branches.map(({ ref, oid }) => <option key={ref} value={ref}>{ref.replace(/^refs\/(?:heads|remotes)\//u, '')} · {oid.slice(0, 8)}</option>);

  return <section className="git-advanced" aria-label="Advanced Git actions" aria-busy={busy}>
    {detailsError && open && <p className="git-hint" role="status">Git details could not be read safely. Refresh the active workspace.</p>}
    {notice && <p className="git-message" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    <nav className="schema-nav" aria-label="Advanced Git views">
      {([['worktrees', 'Worktrees'], ['stashes', 'Stashes'], ['integration', 'Integrate'], ['conflicts', 'Conflicts']] as const)
        .map(([key, label]) => <Button key={key} aria-current={open && view === key ? 'page' : undefined}
          onClick={() => { if (open && view === key) setOpen(false); else show(key); }}>{label}</Button>)}
    </nav>
    {open && view === 'worktrees' && <div className="git-advanced-content">
      <p className="git-hint">Shared Git directory <bdi>{repository.commonDirectory}</bdi></p>
      {!details && <p role="status">Reading worktree registrations…</p>}
      {details && <ul className="git-advanced-list" aria-label="Registered worktrees">
        {details.worktrees.map((item, row) => <li key={item.path}>
          <div><bdi><strong>{item.branch?.slice(11) ?? 'Detached HEAD'}</strong> · {item.head?.slice(0, 12) ?? 'Unborn'}</bdi>
            <small><bdi>{item.path}</bdi> {item.active ? ' · Active' : ''}{item.locked ? ' · Locked' : ''}{item.missing ? ' · Unavailable' : ''}</small></div>
          <div>
            <Button onClick={() => void start({ kind: 'worktree-inspect', row, path: item.path })} disabled={busy || item.active || item.missing}>Inspect</Button>
            <Button onClick={() => void start({ kind: 'worktree-open', row, path: item.path })} disabled={busy || item.active || item.missing}>Open separately</Button>
            <Button onClick={() => void start({ kind: 'worktree-remove', row, path: item.path })} disabled={busy || item.primary || item.active || item.locked || item.missing}>Review removal</Button>
          </div>
        </li>)}
      </ul>}
      <form className="git-advanced-form" onSubmit={(event) => {
        event.preventDefault();
        void start({ kind: 'worktree-add', ref: worktreeRef, folder: folder.trim(), branch: newBranch.trim() || null });
      }}>
        <label>Base branch <select value={worktreeRef} onChange={(event) => setWorktreeBranch(event.target.value)}>
          <option value="">Choose branch…</option>
          {branches.filter(({ ref }) => ref.startsWith('refs/heads/')).map(({ ref }) => <option key={ref} value={ref}>{ref.slice(11)}</option>)}
        </select></label>
        <label>Folder name <Input value={folder} maxLength={120} onChange={(event) => setFolder(event.target.value)} required /></label>
        <label>New branch (optional) <Input value={newBranch} maxLength={240} onChange={(event) => setNewBranch(event.target.value)} /></label>
        <Button type="submit" variant="primary" disabled={locked || !head || !isGitReviewInput({ id, revision, kind: 'worktree-add',
          ref: worktreeRef, folder: folder.trim(), branch: newBranch.trim() || null })}>Choose Parent and Review</Button>
      </form>
    </div>}
    {open && view === 'stashes' && <div className="git-advanced-content">
      <p className="git-hint">Stashes are shared across this repository’s worktrees. Apply restores the index on a clean checkout.</p>
      {!details ? <p role="status">Reading stash history…</p> : details.stashes.length === 0 ? <p>No saved stashes.</p> :
        <ul className="git-advanced-list" aria-label="Shared stashes">{details.stashes.map((stash, row) => <li key={stash.oid + row}>
          <div><bdi>{stash.label}</bdi><small><code>{stash.oid.slice(0, 12)}</code></small></div>
          <div>{([['stash-inspect', 'Inspect'], ['stash-apply', 'Apply'], ['stash-pop', 'Pop'], ['stash-drop', 'Review drop']] as const)
            .map(([action, label]) => <Button key={action} onClick={() => void start({ kind: action, row, oid: stash.oid })}
              disabled={busy || (locked && action !== 'stash-inspect')}>{label}</Button>)}</div>
        </li>)}</ul>}
      <form className="git-advanced-form" onSubmit={(event) => {
        event.preventDefault();
        void start({ kind: 'stash-create', message: stashMessage.trim(), untracked });
      }}>
        <label>Stash message <Input value={stashMessage} onChange={(event) => setStashMessage(event.target.value)} required maxLength={240} /></label>
        <label className="git-inline-choice"><input type="checkbox" checked={untracked} onChange={(event) => setUntracked(event.target.checked)} />Include untracked files</label>
        <Button variant="primary" type="submit" disabled={locked || !head || !repository.changes.length || !stashMessage.trim()}>Review Stash</Button>
      </form>
    </div>}
    {open && view === 'integration' && <div className="git-advanced-content">
      <p className="git-hint">Target <bdi>{branch ?? 'Detached HEAD'}</bdi> · <code>{head?.slice(0, 12) ?? 'Unborn'}</code></p>
      <form className="git-advanced-form" onSubmit={(event) => { event.preventDefault(); void start(selection); }}>
        <label>Operation <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="merge">Merge</option><option value="rebase">Rebase</option><option value="cherry-pick">Cherry-pick</option>
        </select></label>
        {kind !== 'cherry-pick' && <label>Source branch <select aria-label="Source branch" value={source} onChange={(event) => { setSource(event.target.value); setCommit(''); }}>
          <option value="">Select branch…</option>{options}</select></label>}
        <label>{kind === 'cherry-pick' ? 'Full commit ID' : 'Or full commit ID'} <Input value={commit} onChange={(event) => setCommit(event.target.value)} maxLength={64} /></label>
        {kind === 'merge' && <label>Strategy <select value={strategy} onChange={(event) => setStrategy(event.target.value as typeof strategy)}>
          <option value="ff-only">Fast-forward only</option><option value="merge">Merge commit</option></select></label>}
        <Button variant="primary" type="submit" disabled={locked || !isGitReviewInput({ id, revision, ...selection })}>Review Integration</Button>
      </form>
      <details className="git-review-version">
        <summary>Guarded branch and file actions</summary>
        <div className="git-advanced-form">
          <label>Selected branch <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Select branch…</option>{options}</select></label>
          <label>New branch name <Input value={rename} onChange={(event) => setRename(event.target.value)} maxLength={240} /></label>
          <Button disabled={locked || !source.startsWith('refs/heads/') || !rename.trim()}
            onClick={() => void start({ kind: 'branch-rename', ref: source, name: rename.trim() })}>Review Rename</Button>
          <Button disabled={locked || !source.startsWith('refs/heads/')}
            onClick={() => void start({ kind: 'branch-delete', ref: source })}>Review Delete</Button>
          <label>Tracked file path <Input value={filePath} onChange={(event) => setFilePath(event.target.value)} maxLength={1024} /></label>
          <Button disabled={locked || !source || !filePath.trim() || repository.changes.length > 0}
            onClick={() => void start({ kind: 'file-replace', ref: source, path: filePath.trim() })}>Review Replacement</Button>
        </div>
      </details>
    </div>}
    {open && view === 'conflicts' && <div className="git-advanced-content">
      <p className="git-hint">Edit conflicted paths in your external editor, save the file, then review it here before staging.</p>
      {details?.conflicts.length ? <ul className="git-advanced-list" aria-label="Conflicted paths">
        {details.conflicts.map((path, row) => <li key={path}><bdi>{path}</bdi><div>
          <Button disabled={busy} onClick={() => void start({ kind: 'conflict-inspect', row })}>Inspect versions</Button>
          <Button disabled={busy} onClick={() => void start({ kind: 'conflict-reveal', row })}>Reveal working file</Button>
          <Button disabled={busy} onClick={() => void start({ kind: 'conflict-stage', row })}>Review Resolution</Button>
        </div></li>)}</ul> : <p>No unresolved paths in the index.</p>}
      {operation && <div className="git-advanced-form">
        <Button disabled={busy || !details?.recovery || Boolean(details.conflicts.length)} onClick={() => void start({ kind: 'continue' })}>Review Continue</Button>
        <Button disabled={busy || !details?.recovery} onClick={() => void start({ kind: 'abort' })}>Review Abort</Button>
        {!details?.recovery && <p className="git-hint">Recovery for this operation is available in the Git client that started it.</p>}
      </div>}
    </div>}
    {review && <Dialog title={review.title} className="git-operation-dialog" onClose={() => { if (!busy) setReview(undefined); }}>
      <div className="git-operation-review">
        <p className="git-review-detail"><bdi>{review.detail}</bdi></p>
        {review.blocked && <p className="git-message git-message--warning" role="alert">{review.blocked}</p>}
        {review.files.length > 0 && <ul className="git-review" aria-label="Reviewed paths">
          {review.files.map((path, index) => <li key={index}><bdi>{path}</bdi></li>)}
        </ul>}
        {review.versions.map(({ label, value }) => <details className="git-review-version" key={label} open>
          <summary>{label}{value.truncated ? ' · truncated' : ''}</summary><pre tabIndex={0}>{value.text || 'Empty file'}</pre>
        </details>)}
        {review.patch && <details className="git-review-version" open>
          <summary>Reviewed content{review.patch.truncated ? ' · truncated' : ''}</summary><pre tabIndex={0}>{review.patch.text || 'No text differences'}</pre>
        </details>}
      </div>
      <div className="dialog-actions">
        <Button data-dialog-focus disabled={busy} onClick={() => setReview(undefined)}>{review.ticket ? 'Cancel' : 'Close'}</Button>
        {review.blocked?.includes('explicitly stash') && <>
          <Button onClick={() => { setReview(undefined); show('stashes'); }}>Review Stash Options</Button>
          <Button onClick={() => { setReview(undefined); show('worktrees'); }}>Review Worktree Options</Button>
        </>}
        {review.ticket && <Button variant="primary" disabled={busy} onClick={() => void apply()}>Confirm Reviewed Operation</Button>}
      </div>
    </Dialog>}
  </section>;
}
