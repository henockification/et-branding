import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { decideDraft, editDraft } from "#/server/content-queue";

type Mode = "idle" | "editing" | "rejecting";

/**
 * Approve / Edit / Reject under a draft, the web twin of the Telegram buttons.
 *
 * Editing approves in the same act, and a rejection asks why without insisting
 * — exactly as in the chat, so the agents learn the same way from both.
 */
export function DraftActions({
	orgId,
	itemId,
	body,
	status,
}: {
	orgId: string;
	itemId: string;
	body: string;
	status: string;
}) {
	const router = useRouter();
	const [mode, setMode] = useState<Mode>("idle");
	const [text, setText] = useState(body);
	const [reason, setReason] = useState("");

	const done = () => {
		setMode("idle");
		router.invalidate();
	};

	const decide = useMutation({
		mutationFn: (decision: "approved" | "rejected") =>
			decideDraft({
				data: {
					orgId,
					itemId,
					decision,
					...(decision === "rejected" && reason.trim()
						? { reason: reason.trim() }
						: {}),
				},
			}),
		onSuccess: done,
	});

	const save = useMutation({
		mutationFn: () => editDraft({ data: { orgId, itemId, body: text.trim() } }),
		onSuccess: done,
	});

	const error = decide.error ?? save.error;
	const busy = decide.isPending || save.isPending;

	if (mode === "editing") {
		return (
			<div className="space-y-2">
				<Textarea
					rows={8}
					value={text}
					onChange={(event) => setText(event.target.value)}
					aria-label="Your version of the post"
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						disabled={busy || text.trim().length < 10}
						onClick={() => save.mutate()}
					>
						{save.isPending ? "Saving…" : "Save and approve"}
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
						Cancel
					</Button>
					<span className="type-caption text-muted-foreground">
						The original is kept so the agents learn what you changed.
					</span>
				</div>
				{error ? <ErrorLine message={error.message} /> : null}
			</div>
		);
	}

	if (mode === "rejecting") {
		return (
			<div className="space-y-2">
				<Input
					value={reason}
					placeholder="What was wrong? Too formal, wrong facts, … (optional)"
					maxLength={1000}
					onChange={(event) => setReason(event.target.value)}
					aria-label="Why it was rejected"
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant="destructive"
						disabled={busy}
						onClick={() => decide.mutate("rejected")}
					>
						{decide.isPending ? "Rejecting…" : "Reject"}
					</Button>
					<Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
						Cancel
					</Button>
					<span className="type-caption text-muted-foreground">
						A reason teaches the agents; a bare rejection does not.
					</span>
				</div>
				{error ? <ErrorLine message={error.message} /> : null}
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				{status === "draft" ? (
					<Button
						size="sm"
						disabled={busy}
						onClick={() => decide.mutate("approved")}
					>
						{decide.isPending ? "Approving…" : "Approve"}
					</Button>
				) : null}
				{status !== "published" ? (
					<Button
						size="sm"
						variant="secondary"
						disabled={busy}
						onClick={() => {
							setText(body);
							setMode("editing");
						}}
					>
						Edit
					</Button>
				) : null}
				{status === "draft" ? (
					<Button
						size="sm"
						variant="ghost"
						disabled={busy}
						onClick={() => setMode("rejecting")}
					>
						Reject
					</Button>
				) : null}
			</div>
			{error ? <ErrorLine message={error.message} /> : null}
		</div>
	);
}

function ErrorLine({ message }: { message: string }) {
	return <p className="type-caption text-destructive">{message}</p>;
}
