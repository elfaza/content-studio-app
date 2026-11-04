"use client";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, Copy, LoaderCircle } from "lucide-react";
import {
  Dataset,
  Entity,
  RecordData,
  stages,
  platforms,
  metricKeys,
  today,
  validate,
  stage,
} from "@/lib/domain";
import { CategoryField } from "./category-field";
const base = z.object({ title: z.string().optional() }).catchall(z.string());
export default function Editor({
  entity,
  record,
  dataset,
  onSave,
  onSavePost,
  lockedIdeaId,
  saveLabel = "Save changes",
  publishing = false,
}: {
  entity: Entity;
  record?: Partial<RecordData>;
  dataset: Dataset;
  onSave: (entity: Entity, data: Record<string, string>) => Promise<void>;
  onSavePost?: (data: Record<string, string>) => Promise<Dataset | undefined>;
  lockedIdeaId?: string;
  saveLabel?: string;
  publishing?: boolean;
}) {
  const defaults: Record<string, string> = {
    category: "",
    date: today(),
    priority: "Medium",
    status:
      entity === "videos"
        ? "Posted"
        : entity === "schedule"
          ? "Scheduled"
          : "Idea",
    platform:
      entity === "ideas" ? dataset.settings[0]?.platform || "All" : "Instagram",
    difficulty: "Easy",
    needFootage: "Yes",
    time: "19:00",
    theme: "dark",
    timezone: "Asia/Jakarta",
    ...record,
    ...(lockedIdeaId ? { ideaId: lockedIdeaId } : {}),
  };
  const { register, handleSubmit, getValues, setValue, control } = useForm<
    Record<string, string>
  >({
    defaultValues: defaults,
    resolver: zodResolver(base),
  });
  const currentStage = stage(useWatch({ control, name: "status" }) || "Idea");
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [copied, setCopied] = useState("");
  const field = (
    key: string,
    label: string,
    options?: readonly string[],
    type = "text",
  ) =>
    key === "category" ? (
      <Controller
        key={key}
        name="category"
        control={control}
        render={({ field }) => (
          <CategoryField
            value={field.value || ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            categories={[
              ...dataset.ideas.map((r) => r.category),
              ...dataset.videos.map((r) => r.category),
              ...(dataset.settings[0]?.categories || "").split(","),
              ...(record?.category ? [record.category] : []),
            ].filter((c): c is string => Boolean(c))}
          />
        )}
      />
    ) : (
      <label
        className={
          [
            "script",
            "shots",
            "notes",
            "relevance",
            "visualNotes",
            "overlay",
          ].includes(key)
            ? "field full"
            : "field"
        }
        key={key}
      >
        <span>{label}</span>
        {options ? (
          <select {...register(key)}>
            {[
              ...new Set([
                ...options,
                ...(record?.[key] && !options.includes(record[key]!)
                  ? [record[key]!]
                  : []),
              ]),
            ].map((o) => (
              <option key={o} value={o}>
                {o || "Not recorded"}
              </option>
            ))}
          </select>
        ) : [
            "cancellationReason",
            "script",
            "shots",
            "hook",
            "notes",
            "relevance",
            "visualNotes",
            "overlay",
            "audience",
          ].includes(key) ? (
          <>
            <textarea
              rows={
                key === "script" || key === "shots"
                  ? 5
                  : key === "cancellationReason"
                    ? 3
                    : 2
              }
              required={key === "cancellationReason"}
              maxLength={key === "cancellationReason" ? 2000 : undefined}
              {...register(key)}
            />
            {["script", "shots", "hook"].includes(key) && (
              <button
                className="copy-button"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getValues(key) || "");
                    setCopied(key);
                    setTimeout(() => setCopied(""), 1500);
                  } catch {
                    setError(
                      "Clipboard unavailable. Select and copy the text.",
                    );
                  }
                }}
              >
                {copied === key ? <Check size={13} /> : <Copy size={13} />}{" "}
                {copied === key ? "Copied" : "Copy"}
              </button>
            )}
          </>
        ) : (
          <input
            type={type}
            min={type === "number" ? 0 : undefined}
            step={type === "number" ? "any" : undefined}
            {...register(key)}
          />
        )}
      </label>
    );
  const selectRecord = (
    key: string,
    label: string,
    rows: RecordData[],
    optional = false,
  ) => (
    <label className="field full">
      <span>{label}</span>
      <select
        {...register(key)}
        onChange={(e) => {
          setValue(key, e.target.value);
          const item = rows.find((r) => r.id === e.target.value);
          if (item && ["contentId", "videoId"].includes(key))
            setValue("title", item.title);
        }}
      >
        <option value="">
          {optional ? "No linked idea" : "Choose content…"}
        </option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>
    </label>
  );
  const linkedPosts = dataset.videos.filter((v) => v.ideaId === record?.id);
  const [postEditor, setPostEditor] = useState<Partial<RecordData> | null>(
    null,
  );
  const [postNotice, setPostNotice] = useState("");
  const openPostEditor = () => {
    setPostEditor(
      linkedPosts[0] || {
        ideaId: record?.id,
        title: getValues("title"),
        category: getValues("category"),
        duration: getValues("duration"),
      },
    );
  };
  const submit = async (data: Record<string, string>) => {
    setError("");
    try {
      if (
        entity === "ideas" &&
        record?.id &&
        onSavePost &&
        data.status === "Published" &&
        !linkedPosts.length
      ) {
        openPostEditor();
        return;
      }
      validate(entity, data);
      setSaving(true);
      await onSave(entity, data);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ")
          : e instanceof Error
            ? e.message
            : "Could not save",
      );
    } finally {
      setSaving(false);
    }
  };
  if (postEditor && onSavePost)
    return (
      <div className="post-editor-view">
        <button
          type="button"
          className="button outline"
          onClick={() => setPostEditor(null)}
        >
          ← Back to idea
        </button>
        <p className="muted small">
          Idea changes remain in your draft. Only Save post links writes the
          links.
        </p>
        <Editor
          entity="videos"
          saveLabel="Save post links"
          record={postEditor}
          lockedIdeaId={record?.id}
          dataset={dataset}
          onSave={async (_, data) => {
            const updated = await onSavePost(data);
            const latest = updated?.ideas.find((i) => i.id === record?.id);
            // Only rebase a version when the stored idea itself is unchanged. This
            // permits sidecar registration without concealing an external edit.
            if (
              latest &&
              record &&
              Object.entries(record).every(
                ([key, value]) => key === "version" || latest[key] === value,
              )
            )
              setValue("version", latest.version);
            setValue("status", "Published", { shouldDirty: true });
            setPostEditor(null);
            setPostNotice(
              "Post links saved. Save the idea below to apply its details and Published stage.",
            );
          }}
        />
      </div>
    );
  return (
    <form onSubmit={handleSubmit((data) => submit(data))}>
      <div className="form-grid">
        {entity === "ideas" && (
          <>
            {field("title", "Content title")}
            {field("category", "Category")}
            <section className="publish-link-section full">
              <h3>Published post links</h3>
              {linkedPosts.length ? (
                linkedPosts.map((post) => (
                  <div className="saved-post-links" key={post.id}>
                    {(
                      [
                        ["Instagram", "igUrl"],
                        ["TikTok", "tiktokUrl"],
                        ["YouTube", "youtubeUrl"],
                      ] as const
                    ).map(
                      ([platform, key]) =>
                        post[key] && (
                          <div key={key}>
                            <strong>{platform}</strong>
                            {/^https?:\/\//i.test(post[key]) ? (
                              <a
                                href={post[key]}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {post[key]}
                              </a>
                            ) : (
                              <span>{post[key]}</span>
                            )}
                          </div>
                        ),
                    )}
                  </div>
                ))
              ) : (
                <p className="muted small">No published post links yet.</p>
              )}
              {postNotice && (
                <p className="small" role="status">
                  {postNotice}
                </p>
              )}
              {onSavePost ? (
                <button
                  type="button"
                  className="button outline"
                  disabled={saving || !dataset.writable}
                  onClick={openPostEditor}
                >
                  {linkedPosts.length
                    ? "Edit published post links"
                    : "Add published post link"}
                </button>
              ) : (
                <p className="muted small">
                  Save this idea first, then reopen it to add published post
                  links.
                </p>
              )}
            </section>
            {field("priority", "Priority", [
              "High",
              "Medium",
              "Low",
              ...(record?.priority &&
              !["High", "Medium", "Low"].includes(record.priority)
                ? [record.priority]
                : []),
            ])}
            {field("status", "Production stage", [
              ...stages,
              ...(record?.status &&
              !stages.includes(record.status as (typeof stages)[number])
                ? [record.status]
                : []),
            ])}
            {currentStage === "Cancelled" ? (
              <>
                {field("cancellationReason", "Cancellation reason")}
                <p className="form-note full">
                  Saving cancels pending schedules too. Restoring this idea will
                  not restart old schedules.
                </p>
              </>
            ) : (
              <>
                {record?.id && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() =>
                      setValue("status", "Cancelled", { shouldDirty: true })
                    }
                  >
                    Cancel idea
                  </button>
                )}
                {record?.cancelledAt && (
                  <p className="cancellation-note full">
                    <strong>Previous cancellation:</strong>{" "}
                    {record.cancellationReason}
                  </p>
                )}
              </>
            )}
            {field("platform", "Target platform", ["All", ...platforms])}
            {field("difficulty", "Difficulty", ["Easy", "Medium", "Hard"])}
            {field("date", "Discovered on", undefined, "date")}
            {field(
              "duration",
              "Target duration (seconds)",
              undefined,
              "number",
            )}
            {field("deadline", "Production deadline", undefined, "date")}
            {field("needFootage", "Need new footage?", ["Yes", "No"])}
            {field("footageRecorded", "Footage recorded?", ["", "Yes", "No"])}
            {field("relevance", "Why this fits me")}
            {field("hook", "Hook · first 3 seconds")}
            {field("script", "Script / story")}
            {field("shots", "Shot list")}
            {field("overlay", "Text overlays")}
            {field("cta", "CTA / ending")}
            {field("reference", "Reference / source")}
            {field("footageReference", "Footage reference")}
            {field("visualNotes", "Visual notes")}
            {field("trend", "Trend / inspiration")}
            {field("notes", "Production & performance notes")}
          </>
        )}
        {entity === "videos" && (
          <>
            {publishing && (
              <p className="form-note full">
                Paste at least one live post link below. Saving the post will
                also mark the linked idea Published. Your idea details have been
                kept.
              </p>
            )}
            {field("title", "Video title")}
            {field("category", "Category")}
            {lockedIdeaId ? (
              <p className="form-note full">
                Linked to this idea. Your idea draft will remain available when
                you go back.
              </p>
            ) : (
              selectRecord(
                "ideaId",
                "Related content idea",
                dataset.ideas,
                true,
              )
            )}
            {field("duration", "Duration (seconds)", undefined, "number")}
            {platforms.map((p) => {
              const prefix =
                p === "Instagram"
                  ? "ig"
                  : p === "TikTok"
                    ? "tiktok"
                    : "youtube";
              return (
                <div className="platform-fields full" key={p}>
                  <h3>{p}</h3>
                  <div className="form-grid">
                    {field(prefix + "Url", p + " post link", undefined, "url")}
                    {field(
                      prefix + "Date",
                      "Actual publish date",
                      undefined,
                      "date",
                    )}
                    {field(
                      prefix + "Time",
                      "Actual publish time · WIB",
                      undefined,
                      "time",
                    )}
                  </div>
                </div>
              );
            })}
            {field("notes", "Notes")}
          </>
        )}
        {entity === "snapshots" && (
          <>
            {selectRecord("videoId", "Published video", dataset.videos)}
            {field("platform", "Platform", platforms)}
            {field("date", "Observation date · WIB", undefined, "date")}
            <p className="form-note full">
              Blank means unknown. Enter 0 only for a measured zero. One
              snapshot per video, platform, and date; saved observations are
              append-only.
            </p>
            {metricKeys.map((k) =>
              field(
                k,
                {
                  views: "Views",
                  likes: "Likes",
                  comments: "Comments",
                  shares: "Shares",
                  reposts: "Reposts",
                  saves: "Saves",
                  uniqueViewers: "Unique viewers",
                  avgWatch: "Average watch (seconds)",
                  watchedFull: "Watched full (%)",
                  follows: "New follows",
                  profileVisits: "Profile visits",
                  linkTaps: "Bio link taps",
                  interactions: "Interactions",
                  nonFollower: "Non-follower views (%)",
                }[k],
                undefined,
                "number",
              ),
            )}
            {field("audience", "Audience / traffic notes")}
            {field("source", "Data source / context")}
            {field("notes", "Notes")}
          </>
        )}
        {entity === "schedule" && (
          <>
            {selectRecord("contentId", "Content to schedule", [
              ...dataset.ideas,
              ...dataset.videos,
            ])}
            {field("title", "Event title")}
            {field("platform", "Platform", platforms)}
            {field("date", "Planned date · WIB", undefined, "date")}
            {field("time", "Planned time · WIB", undefined, "time")}
            {field("status", "Schedule status", [
              "Scheduled",
              "Published",
              "Cancelled",
            ])}
            {field("notes", "Notes")}
            <p className="form-note full">
              This saves a plan. It does not publish to social platforms or
              change actual publishing history.
            </p>
          </>
        )}
        {entity === "settings" && (
          <>
            {field("creator", "Creator name")}
            {field("platform", "Default platform", ["All", ...platforms])}
            {field("categories", "Default categories · comma separated")}
            {field("theme", "Theme", ["dark", "light"])}
            {field("timezone", "Timezone", ["Asia/Jakarta"])}
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-footer">
        <span className="muted small">
          {dataset.mode === "demo"
            ? "Saves to demo workspace"
            : "Saves to Google Sheets"}{" "}
          · Asia/Jakarta
        </span>
        <button
          className="button primary"
          disabled={saving || !dataset.writable}
        >
          {saving ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
    </form>
  );
}
