import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import {
	addPastPost,
	deletePastPost,
	fetchPastPosts,
} from "#/server/brand-documents";

/** Matches MIN_LENGTH in server/telegram/capture.ts. */
const MIN_LENGTH = 40;

/**
 * The posts the Brand Brain writes like.
 *
 * The same store as forwarding a post to the bot. Taking a weak post out is as
 * useful as adding a good one: every post here pulls on every draft.
 */
export function PastPosts({ orgId }: { orgId: string }) {
	const queryClient = useQueryClient();
	const queryKey = ["past-posts", orgId];
	const posts = useQuery({
		queryKey,
		queryFn: () => fetchPastPosts({ data: { orgId } }),
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey });

	const [content, setContent] = useState("");

	const add = useMutation({
		mutationFn: () => addPastPost({ data: { orgId, content: content.trim() } }),
		onSuccess: () => {
			setContent("");
			refresh();
		},
	});

	const remove = useMutation({
		mutationFn: (postId: string) => deletePastPost({ data: { orgId, postId } }),
		onSuccess: refresh,
	});

	if (!posts.data?.found) return null;
	const { canEdit, posts: list, limit } = posts.data;
	const tooShort = content.trim().length < MIN_LENGTH;

	return (
		<section id="past-posts" className="space-y-brand-6">
			<header className="space-y-2">
				<h2 className="type-title">Past posts</h2>
				<p className="type-caption text-muted-foreground">
					{list.length} of {limit}. The agents match their rhythm and register
					on every draft. Around 30 good ones gives them a real feel for the
					voice. You can also forward posts to the Telegram bot.
				</p>
			</header>

			{canEdit ? (
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (!tooShort) add.mutate();
					}}
				>
					<Label htmlFor="past-post">Add a post that sounds like you</Label>
					<Textarea
						id="past-post"
						rows={4}
						value={content}
						placeholder="Paste a post you were happy with…"
						onChange={(event) => setContent(event.target.value)}
					/>
					<div className="flex items-center gap-brand-4">
						<Button type="submit" disabled={add.isPending || tooShort}>
							{add.isPending ? "Adding…" : "Add to the brain"}
						</Button>
						{content.trim() && tooShort ? (
							<span className="type-caption text-muted-foreground">
								At least {MIN_LENGTH} characters.
							</span>
						) : null}
						{add.isError ? (
							<span className="type-caption text-destructive">
								{add.error.message}
							</span>
						) : null}
					</div>
				</form>
			) : null}

			{list.length === 0 ? (
				<p className="type-body text-muted-foreground">
					Nothing yet — the agents are writing from the brand profile alone.
				</p>
			) : (
				<ul className="space-y-brand-4">
					{list.map((post) => (
						<li key={post.id} className="rounded-lg border bg-card p-brand-4">
							<p className="type-body whitespace-pre-wrap">{post.content}</p>
							<div className="mt-2 flex items-center justify-between gap-2">
								<span className="type-caption text-muted-foreground">
									{post.source?.startsWith("telegram")
										? "from Telegram"
										: "added here"}{" "}
									· {new Date(post.createdAt).toLocaleDateString()}
								</span>
								{canEdit ? (
									<Button
										variant="ghost"
										size="xs"
										disabled={remove.isPending}
										onClick={() => {
											if (window.confirm("Take this post out of the brain?")) {
												remove.mutate(post.id);
											}
										}}
									>
										Remove
									</Button>
								) : null}
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
