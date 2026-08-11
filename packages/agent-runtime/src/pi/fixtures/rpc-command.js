export default function registerOvertchatTestCommand(pi) {
  pi.registerCommand("overtchat-test-name", {
    description: "Set the session name without a model turn",
    handler: async (args) => {
      pi.setSessionName(args.trim());
    },
  });
}
