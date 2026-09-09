import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactNode
} from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypePrismPlus from "rehype-prism-plus"
import "@/lib/prism-langs"
import { cn } from "@/lib/utils"
import {
  attachmentSrc,
  attachmentViewParams,
  parseAttachmentUrl,
  parseMentionHref
} from "@projectproject/shared"
import { MentionChip } from "@/components/Lexical/MentionChip"
import {
  ATTACHMENT_IMAGE_CLASS,
  attachmentWidthStyle
} from "@/components/Lexical/attachmentImageStyle"
import { AttachmentChip } from "@/components/AttachmentChip"

const prismPlugin = [rehypePrismPlus, { ignoreMissing: true }] as const

const allowMentionUrls = (url: string) => {
  if (url.startsWith("mention:")) return url
  if (parseAttachmentUrl(url)) return url
  return defaultUrlTransform(url)
}

const attachmentLabel = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child): string => {
      if (typeof child === "string" || typeof child === "number")
        return String(child)
      if (isValidElement<{ children?: ReactNode }>(child))
        return attachmentLabel(child.props.children)
      return ""
    })
    .join("")

const linkedAttachmentContent = (
  children: ReactNode,
  morphId: string
): ReactNode =>
  Children.map(children, (child, index) => {
    if (
      !isValidElement<{ src?: string; alt?: string; children?: ReactNode }>(
        child
      )
    )
      return child
    const { src, alt, children: nested } = child.props
    const id = `${morphId}-${index}`
    if (
      src &&
      parseAttachmentUrl(src) &&
      attachmentViewParams(src).density === "compact"
    ) {
      return (
        <AttachmentChip
          variant="linked"
          url={attachmentSrc(src)}
          alt={alt ?? ""}
          filename={alt ?? ""}
          kind="image"
          morphId={id}
        />
      )
    }
    return nested === undefined
      ? child
      : cloneElement(child, {}, linkedAttachmentContent(nested, id))
  })

export function Markdown({
  children,
  className
}: {
  children: string
  className?: string
}) {
  const attachmentId = useId()
  return (
    <div className={cn("prose-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[prismPlugin as never]}
        urlTransform={allowMentionUrls}
        components={{
          a: ({ href, children: linkChildren, node, ...rest }) => {
            if (
              href &&
              parseAttachmentUrl(href) &&
              attachmentViewParams(href).density === "compact"
            ) {
              const label = attachmentLabel(linkChildren)
              return (
                <AttachmentChip
                  url={attachmentSrc(href)}
                  alt={label}
                  filename={label}
                  kind="file"
                  morphId={`${attachmentId}-${node?.position?.start.offset}`}
                />
              )
            }
            const ref = href ? parseMentionHref(href) : null
            if (!ref) {
              return (
                <a href={href} {...rest}>
                  {linkedAttachmentContent(
                    linkChildren,
                    `${attachmentId}-${node?.position?.start.offset}`
                  )}
                </a>
              )
            }
            const label =
              typeof linkChildren === "string" ? linkChildren : ref.id
            return <MentionChip type={ref.type} id={ref.id} label={label} />
          },
          img: ({ src, alt, node, ...rest }) => {
            const url = typeof src === "string" ? src : undefined
            if (
              url &&
              parseAttachmentUrl(url) &&
              attachmentViewParams(url).density === "compact"
            ) {
              return (
                <AttachmentChip
                  url={attachmentSrc(url)}
                  alt={alt ?? ""}
                  filename={alt ?? ""}
                  kind="image"
                  morphId={`${attachmentId}-${node?.position?.start.offset}`}
                />
              )
            }
            const width = url ? attachmentViewParams(url).width : null
            return (
              <img
                src={url}
                alt={alt ?? ""}
                loading="lazy"
                decoding="async"
                style={attachmentWidthStyle(width)}
                className={cn("my-2", ATTACHMENT_IMAGE_CLASS)}
                {...rest}
              />
            )
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
