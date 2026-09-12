# overtchat for Android

The Android app is on Google Play, open to anyone — no testers group, no invite:

**https://play.google.com/store/apps/details?id=com.overtchat.mobile**

It's a thin client. On first launch it asks for the URL of an overtchat server
you control; conversations live on your server or connected agent host. Unsent
agent drafts are saved on the device. If you don't have a
server yet, start with the [quick start](../README.md#quick-start).

## Agent Connections

Open **Agent Connections** in the drawer. Configure connections and workspaces
on the web first, using the same account. Workspaces group chats from all their
agents, with collapsible previews of the five most recent chats. **View all**
opens the workspace’s searchable history; search on the main screen also finds
older chats. Select a chat to resume it, or tap the workspace’s **+** and choose
an agent to open a new chat (a workspace with one agent opens directly). Write and send your first message to create the
session; the provider catalog supplies the initial model, reasoning, and
permission defaults. You can change them in the composer’s settings. **Sync** discovers chats created outside
OvertChat; pull down to refresh the list.

Tap the branded model control in the composer to open agent settings. Model,
reasoning, and permissions each open their own picker; plan mode is available
when supported. The ring in the chat header opens context usage details.
Workspace and chat views show the current Git branch when available. Type `/` for available
commands. Use **+** for photos or the camera, or paste an image into the composer.
Image support depends on the selected model; up to four PNG, JPEG, GIF, or WebP
images are supported (10 MB each, 20 MB combined).

Approvals and questions appear in a sheet. Dismissing the sheet leaves the
request pending; tap **Respond** to return to it. You can stop a running agent
or queue a follow-up. Queued messages appear as cards above the composer, with
edit, steer (when supported), and delete actions. Editing requires an empty
draft and moves the queued message back into the composer. Tap a tool to inspect
its command, changes, or output. Long output expands on demand and can be copied
in full. Permission requests show available command/change details with direct
Allow and Deny actions. Codex file approvals include each available file patch
from the updated connector, including changes to a pending preview. Workspace file browsing is not supported on mobile.

Agents keep running on the host when the app backgrounds. Reopening the chat
resynchronizes it. If a send fails, inspect the conversation before retrying;
the app retains the draft and reuses the message identity for an unchanged
retry. Choose **Already delivered** to clear a draft you found in the chat. If
you have checked that it was not delivered and retry cannot recover it,
**Send again…** lets you confirm a separate send. Connection setup and administration remain on the web.

## Notifications

After your first login, **Know when it’s ready** offers to enable notifications.
Choose **Enable notifications**, then allow notifications when Android asks.
**Not now** skips the prompt without repeated reminders. You can change this
later in **Settings → Notifications**, which has two controls: **Response
notifications** (chat responses and agent idle together) and **Show previews**.
These settings apply only to this device and your account on the selected
server. Existing users with notifications enabled are not prompted again.

Chat alerts say **Your response is ready** when a saved response finishes.
Temporary chats, errors, and cancelled responses do not send that alert.
Agent alerts say **Agent is idle** after it stops working for five seconds;
this is a cue to check the session, not a guarantee of success. They do not
report approval requests or catch up after a server/connector interruption.
Tap an alert to open its conversation. The app suppresses alerts for the
conversation you're currently viewing.

**Show previews** is off by default. Turn it on to include chat answer text or
an agent session name; that content passes through Expo and Apple/Google push
services and may be visible on your lock screen. Turn it off for generic alerts.
Use **Phone notification settings** to manage Android permissions and sounds.
Signing out stops future delivery for that login.

Your server may remain private, but both it and the phone need internet access
for push delivery. To open a conversation, reconnect to the server's LAN or VPN
if needed. Android force-stop prevents notifications until you reopen the app.
If settings report a registration failure, see the
[push setup guide](release.md#mobile-push-credentials).

## Sideload (APK)

Prefer not to use Google Play? Every release ships a universal APK you can
install directly:

1. Open the releases page:
   https://github.com/yoloyash/overtchat/releases
2. Pick the newest **`mobile-v*`** release (the `v*` releases are the
   self-hosted server, not the app).
3. Download the attached `overtchat-v<version>.apk` and open it on your device
   (you may need to allow "install from unknown sources").

Sideloaded builds don't auto-update — repeat this for each release.

## iOS

Not publicly available. iOS builds stay internal/TestFlight for now, with no
timeline for a store release.

Feedback: ykhurana6@gmail.com
