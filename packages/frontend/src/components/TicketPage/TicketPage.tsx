import { useAtomSet } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import { Archive } from "lucide-react"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { useState } from "react"
import { BackButton } from "@/components/BackButton"
import { CommentsSection } from "@/components/Comments/CommentsSection"
import { ConfirmDeleteIcon } from "@/components/ConfirmDeleteIcon"
import { type SaveStatus } from "@/components/LexicalEditor"
import { MarkdownSaveIndicator } from "@/components/MarkdownSaveIndicator"
import { ArchiveTicketControl } from "@/components/TicketList/ArchiveControl"
import { AssigneePicker } from "@/components/TicketList/AssigneeField"
import { PriorityBadgeTrigger } from "@/components/TicketList/PriorityField"
import { SprintBadgeTrigger } from "@/components/TicketList/SprintField"
import { StatusButton } from "@/components/TicketList/StatusField"
import { TypeBadgeTrigger } from "@/components/TicketList/TypeField"
import { TagEditor } from "@/components/TagEditor"
import { TicketGitPanel } from "@/components/TicketGit"
import { TicketTimeSection } from "@/components/time/TicketTimePanel"
import { DescriptionField } from "@/components/TicketPage/DescriptionField"
import { MetaRow } from "@/components/TicketPage/MetaRow"
import { TicketDesignLinks } from "@/components/TicketPage/TicketDesignLinks"
import { TitleField } from "@/components/TicketPage/TitleField"
import { useProjectRole } from "@/lib/projectRole"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import { deleteTicketAtom, ticketKey } from "@/atoms/tickets"
import type {
  GithubConnection,
  Member,
  TicketDetail
} from "@projectproject/shared"

export function TicketPage({
  orgSlug,
  slug,
  ticket,
  members,
  github,
  autoFocusBody = false
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
  members: ReadonlyArray<Member>
  github: GithubConnection | null
  autoFocusBody?: boolean
}) {
  const tKey = ticketKey(orgSlug, slug, ticket.id)
  const remove = useAtomSet(deleteTicketAtom(tKey), { mode: "promiseExit" })
  const [bodyStatus, setBodyStatus] = useState<SaveStatus>("idle")
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()
  const { canManageTags } = useProjectRole()
  const locale = getLocale()

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <BackButton
          fallback={{
            to: "/orgs/$orgSlug/projects/$slug",
            params: { orgSlug, slug }
          }}
        />
        <div className="flex items-center gap-2">
          <MarkdownSaveIndicator status={bodyStatus} />
          <ArchiveTicketControl
            orgSlug={orgSlug}
            slug={slug}
            id={ticket.id}
            archived={ticket.archivedAt !== null}
          />
          <ConfirmDeleteIcon
            ariaLabel={m.tickets_detail_delete_aria_label()}
            message={m.tickets_detail_delete_confirm()}
            disabled={deleting}
            onConfirm={async () => {
              setDeleting(true)
              const exit = await remove()
              if (Exit.isSuccess(exit)) {
                void navigate({
                  to: "/orgs/$orgSlug/projects/$slug",
                  params: { orgSlug, slug }
                })
                return
              }
              setDeleting(false)
              throw Cause.squash(exit.cause)
            }}
          />
        </div>
      </div>
      <header className="flex items-start gap-2">
        <div className="mt-1.5 flex h-[1lh] shrink-0 items-center text-xl">
          <StatusButton
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            query={{ sort: { key: "updated", dir: "desc" } }}
            size="lg"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <h1 className="w-full">
            <TitleField orgSlug={orgSlug} slug={slug} ticket={ticket} />
          </h1>
          <div className="flex items-center gap-1.5 px-2">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {ticket.id}
            </span>
            <TypeBadgeTrigger orgSlug={orgSlug} slug={slug} ticket={ticket} />
            {ticket.archivedAt !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Archive className="size-3" strokeWidth={1.75} />
                {m.tickets_archived_badge()}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="h-px bg-border/60" />

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="flex min-w-0 flex-col gap-6">
          <DescriptionField
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            members={members}
            autoFocus={autoFocusBody}
            onStatusChange={setBodyStatus}
          />

          <CommentsSection orgSlug={orgSlug} slug={slug} ticketId={ticket.id} />
        </main>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-8rem)] lg:self-start lg:overflow-y-auto lg:border-l lg:border-border/60 lg:pl-5 lg:[scrollbar-gutter:stable]">
          <MetaRow label={m.tickets_page_meta_priority()}>
            <PriorityBadgeTrigger
              orgSlug={orgSlug}
              slug={slug}
              ticket={ticket}
            />
          </MetaRow>
          <MetaRow label={m.tickets_page_meta_sprint()}>
            <SprintBadgeTrigger
              orgSlug={orgSlug}
              slug={slug}
              ticketId={ticket.id}
            />
          </MetaRow>
          <MetaRow label={m.tickets_page_meta_assignees()}>
            <AssigneePicker
              orgSlug={orgSlug}
              slug={slug}
              ticket={ticket}
              members={members}
            />
          </MetaRow>
          <MetaRow label={m.tickets_page_meta_tags()}>
            <TagEditor
              orgSlug={orgSlug}
              slug={slug}
              ticket={ticket}
              canManageTags={canManageTags}
            />
          </MetaRow>
          {github && (
            <MetaRow label={m.tickets_page_meta_git()}>
              <TicketGitPanel
                orgSlug={orgSlug}
                slug={slug}
                ticket={ticket}
                github={github}
                branchTemplate={null}
                variant="ghost"
              />
            </MetaRow>
          )}
          <TicketDesignLinks orgSlug={orgSlug} slug={slug} ticket={ticket} />
          <TicketTimeSection orgSlug={orgSlug} slug={slug} ticket={ticket} />
          <MetaRow label={m.tickets_page_meta_created()}>
            <time
              dateTime={ticket.createdAt.toISOString()}
              title={ticket.createdAt.toLocaleString(locale)}
              className="text-xs"
            >
              {ticket.createdAt.toLocaleDateString(locale, {
                year: "numeric",
                month: "short",
                day: "numeric"
              })}
            </time>
          </MetaRow>
          <MetaRow label={m.tickets_page_meta_updated()}>
            <time
              dateTime={ticket.updatedAt.toISOString()}
              title={ticket.updatedAt.toLocaleString(locale)}
              className="text-xs"
            >
              {ticket.updatedAt.toLocaleDateString(locale, {
                year: "numeric",
                month: "short",
                day: "numeric"
              })}
            </time>
          </MetaRow>
        </aside>
      </div>
    </div>
  )
}
