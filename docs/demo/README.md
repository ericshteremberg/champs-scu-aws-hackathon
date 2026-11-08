# Recorded hackathon demo

`casework-hackathon-demo.mp4` is a silent, 1920 x 1080, 30 fps walkthrough finished with Higgsfield's native Higgsedit editor. It follows a single $92 synthetic transaction through automated evidence collection, findings, source inspection, activity, response review, persistence, and Markdown/JSON export. Cursor movement and click rings make the interactions visible.

[Higgsfield-hosted MP4](https://d2ol7oe51mr4n9.cloudfront.net/user_3K2FmAHyLUj9VrCeXg1er4n49Zi/b07e31b7-b595-4132-86b0-6c4289deda9c.mp4). The final export is 33.301 seconds, H.264, and approximately 13.3 MB. Verification included the real recording flow, 49 passing project tests, type checking, a production build, visual review, and decoding the complete exported video without errors.

The recording runs the real application against an isolated local SQLite database. It does not mock API responses or change application content. Only the cursor and click indicators are injected for recording. The final captions and frame are added in Higgsfield. The screenshot supplied as visual direction was not used as evidence of implemented behavior.

## What the video demonstrates

- One click starts collection of payment, order, ticket, delivery, recovery, and support evidence.
- Findings and a response draft appear automatically.
- The viewer can inspect the payment and the fictional customer's ticket acknowledgement, then inspect the activity log.
- A human checks the review confirmation and saves the response.
- Both packet formats download successfully. The case remains reviewed after refresh.

The footer explicitly identifies synthetic records and the deterministic demo investigator. This capture does not call Bedrock, demonstrate a live merchant connection, submit a dispute, or establish recovered funds. The $92 is the disputed amount. The clip's elapsed time is edited presentation timing, not a measured business result.

## Reproduce the recording

From the repository root, after `npm ci`:

```sh
npx playwright install ffmpeg
node scripts/demo/record.mjs /tmp/casework-demo-new-take
```

Google Chrome must be installed. Use a fresh output directory for each take. The recorder uses loopback API port 3108 and web port 5188, avoids loading project environment files, and passes an explicit synthetic configuration. It closes only the processes it creates. It verifies the saved review through the API, exports both files, reloads, and confirms the reviewed case remains present. Any browser page error fails the capture.

`screen-recording.webm` is the intentional source footage. `capture.json` records step timings and verification metadata. The two sample packets contain only synthetic records.

## Higgsfield finish

The edit source is `scripts/demo/edit.jsx`. This take was rendered with native Higgsedit v0.14.0, pinned release `f39e3bc5882b`. In the matching Higgsfield runtime, place the recording and `capture.json` in the working directory, then run:

```sh
higgsedit new casework-edit --size 1920x1080 --fps 30
higgsedit fonts add casework-edit 'DM Sans:400' 'DM Sans:700'
higgsedit build /path/to/scripts/demo/edit.jsx
```

Optional `RAW_VIDEO`, `CAPTURE_META`, and `EDIT_DIR` environment variables select input and output paths. The script trims initial browser loading from the source duration, adds timed step titles and a persistent disclosure, renders two review frames, and exports H.264 MP4. It does not require a generative video model or generative credits.

The source recording, edit script, timing metadata, and final MP4 are intentional handoff assets. Local databases, logs, browser traces, and intermediate renders are excluded.
