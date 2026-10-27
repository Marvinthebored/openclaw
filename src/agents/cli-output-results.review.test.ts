import { expect, it } from "vitest";
import { transformCliResultText } from "./cli-output-results.js";
it("transforms every persisted native narration", () => {
  const output = transformCliResultText(
    {
      text: "OldName",
      assistantMessages: [
        { uuid: "one", text: "OldName progress" },
        { uuid: "two", text: "OldName" },
      ],
    },
    [{ from: "OldName", to: "NewName" }],
  );
  expect(output.assistantMessages?.map((m) => m.text)).toEqual(["NewName progress", "NewName"]);
});
