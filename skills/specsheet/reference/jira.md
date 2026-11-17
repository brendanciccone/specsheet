# Jira

Specsheet never talks to Jira itself. You read and write through the Jira connection the
user already has. If there is no connection, or writing is switched off, the user pastes
and attaches by hand, and everything else still works.

## Reading the ticket

Read the ticket by its key: the summary, the description, and any acceptance criteria.
Use only what the ticket says for `stated` requirements. Do not read other tickets unless
the user asks.

## Before posting: the preview

Read two files in `handoff/<TICKET-KEY>/out/`:

- `comment.md` is the text to post. If the text does not fit in one Jira comment
  (32,767 characters), there will also be `comment-2.md` and so on.
- `manifest.json` lists every file to attach, with its size.

Show the user a preview and wait for a yes:

```
Ready to post to HELP-12.

Comment: 2,862 characters. Summary, 4 requirements, 3 scenarios in Gherkin, 5 states,
1 open question.

Files to attach (1.2 MB in total):
  handoff.html                      809 KB
  flow.png                          189 KB
  4 screenshots                     275 KB
  1 video                           343 KB
  features/contact-form.feature     634 B

Post this to HELP-12?
```

Show the full comment text if the user asks to see it. Ask every time, including when
you are updating an earlier post.

## Posting

1. **Post the text as a comment.** Never edit the ticket's description: it is the PM's
   text, and editing it through a connection can strip images embedded in it.
2. **Upload the files as attachments,** if the connection has an upload tool.
3. **If this handoff was posted before, edit that comment** instead of adding a new one,
   so the ticket does not fill with copies. Find it by its first line, which starts with
   "Design handoff:".
4. **Change nothing else.** Do not move the ticket to another status, reassign it, or
   edit its fields.

Then tell the user what was posted, with the ticket link.

## When something cannot be done

Say plainly what was not posted and why, and leave the rest for the user to do by hand:

- **No upload tool, or an upload fails.** Post the comment, then give the user the
  folder path so they can drag the files in.
- **A file is over the site's attachment limit.** Jira Cloud allows 1 GB per file by
  default, self-hosted Jira often 10 MB, and an admin can set either lower. Skip that
  file and name it.
- **Writing is not allowed.** Give the user `comment.md` to paste and the folder to
  attach.

## Not yet confirmed

These have not been tested on a real ticket. Try them, and fall back as above if they
fail:

- Whether an uploaded screenshot can be placed inline in the comment. If it cannot, the
  comment's file list names each screenshot, and the handoff page has them in context.
- Whether the connection accepts video files of the size a run produces.
