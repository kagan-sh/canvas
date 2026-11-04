import { useEffect, useState } from "react";

import { errorMessage } from "../errors.ts";
import type { ThreadRow } from "../protocol.ts";
import { call } from "./client.ts";
import { toast } from "./toast.tsx";

/** The bottom row that pastes the share note into a thread. Owns its thread list and note. */
export function SendBar({ threadId, canvasName, narrow }: { threadId: string | null; canvasName: string | null; narrow: boolean }) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [target, setTarget] = useState(threadId ?? "");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    setTarget(threadId ?? "");
    setThreads([]);
    if (threadId === null) return () => { live = false; };
    call({ call: "threads", threadId }).then(
      (result) => { if (live) setThreads(result.threads); },
      (cause) => { if (live) toast.error("Couldn't list the threads", errorMessage(cause)); },
    );
    // A reply for the thread we just left must not replace the new thread's choices.
    return () => { live = false; };
  }, [threadId]);

  const send = async () => {
    if (canvasName === null || sending || target === "") return;
    setSending(true);
    try {
      await call({ call: "send", name: canvasName, threadId: target, note });
      setNote("");
      toast.info("Pasted into the thread. Press Enter there to send it.");
    } catch (cause) {
      toast.error("Couldn't send the canvas", errorMessage(cause));
    } finally {
      setSending(false);
    }
  };

  const reason = threadId === null ? "Open a thread to send this canvas to it." : null;
  return (
    <div className="cv-island cv-send">
      <select aria-label="Send to" className="cv-select" value={target} onChange={(event) => setTarget(event.target.value)}>
        {threads.length === 0 ? <option value="">No threads</option> : null}
        {threads.map((thread) => (
          <option key={thread.id} value={thread.id}>
            {thread.id === threadId ? "This thread" : thread.title} · {thread.status}
          </option>
        ))}
      </select>
      <input
        className="cv-field cv-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void send();
        }}
        placeholder={narrow ? "Note for the agent" : "What should the agent do with this?"}
        aria-label="Note for the agent"
      />
      <button type="button" className="cv-primary" onClick={() => void send()} disabled={sending || canvasName === null || target === ""}>
        Send
      </button>
      <p className="cv-caption">
        {reason ?? (
          <>
            Pastes your note and <code>kg canvas show {canvasName ?? "name"}</code> into the thread. Press Enter there to send it.
          </>
        )}
      </p>
    </div>
  );
}
