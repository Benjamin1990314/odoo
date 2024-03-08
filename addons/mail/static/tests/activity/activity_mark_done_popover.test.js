/** @odoo-module alias=@mail/../tests/activity/activity_mark_done_popover_tests default=false */
const test = QUnit.test; // QUnit.test()

import { startServer } from "@bus/../tests/helpers/mock_python_environment";

import { openFormView, start } from "@mail/../tests/helpers/test_utils";

import { makeDeferred, patchWithCleanup } from "@web/../tests/helpers/utils";
import { assertSteps, click, contains, insertText, step } from "@web/../tests/utils";

QUnit.module("activity mark as done popover");

test("activity mark done popover simplest layout", async () => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        res_id: partnerId,
        res_model: "res.partner",
    });
    await start();
    await openFormView("res.partner", partnerId);
    await click(".btn", { text: "Mark Done" });
    await contains(".o-mail-ActivityMarkAsDone");
    await contains(".o-mail-ActivityMarkAsDone textarea[placeholder='Write Feedback']");
    await contains(".o-mail-ActivityMarkAsDone button[aria-label='Done and Schedule Next']");
    await contains(".o-mail-ActivityMarkAsDone button[aria-label='Done']");
    await contains(".o-mail-ActivityMarkAsDone button", { text: "Discard" });
});

test("activity with force next mark done popover simplest layout", async () => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        chaining_type: "trigger",
        res_id: partnerId,
        res_model: "res.partner",
    });
    await start();
    await openFormView("res.partner", partnerId);
    await click(".btn", { text: "Mark Done" });
    await contains(".o-mail-ActivityMarkAsDone");
    await contains(".o-mail-ActivityMarkAsDone textarea[placeholder='Write Feedback']");
    await contains(".o-mail-ActivityMarkAsDone button[aria-label='Done and Schedule Next']");
    await contains(".o-mail-ActivityMarkAsDone button[aria-label='Done']", { count: 0 });
    await contains(".o-mail-ActivityMarkAsDone button", { text: "Discard" });
});

test("activity mark done popover mark done without feedback", async (assert) => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    const activityId = pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        res_id: partnerId,
        res_model: "res.partner",
    });
    await start({
        async mockRPC(route, args) {
            if (route === "/web/dataset/call_kw/mail.activity/action_feedback") {
                step("action_feedback");
                assert.strictEqual(args.args.length, 1);
                assert.strictEqual(args.args[0].length, 1);
                assert.strictEqual(args.args[0][0], activityId);
                assert.strictEqual(args.kwargs.attachment_ids.length, 0);
                assert.notOk(args.kwargs.feedback);
                // random value returned in order for the mock server to know that this route is implemented.
                return true;
            }
            if (route === "/web/dataset/call_kw/mail.activity/unlink") {
                // 'unlink' on non-existing record raises a server crash
                throw new Error(
                    "'unlink' RPC on activity must not be called (already unlinked from mark as done)"
                );
            }
        },
    });
    await openFormView("res.partner", partnerId);
    await click(".btn", { text: "Mark Done" });
    await click(".o-mail-ActivityMarkAsDone button[aria-label='Done']");
    await assertSteps(["action_feedback"]);
});

test("activity mark done popover mark done with feedback", async (assert) => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    const activityId = pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        res_id: partnerId,
        res_model: "res.partner",
    });
    await start({
        async mockRPC(route, args) {
            if (route === "/web/dataset/call_kw/mail.activity/action_feedback") {
                step("action_feedback");
                assert.strictEqual(args.args.length, 1);
                assert.strictEqual(args.args[0].length, 1);
                assert.strictEqual(args.args[0][0], activityId);
                assert.strictEqual(args.kwargs.attachment_ids.length, 0);
                assert.strictEqual(args.kwargs.feedback, "This task is done");
                // random value returned in order for the mock server to know that this route is implemented.
                return true;
            }
            if (route === "/web/dataset/call_kw/mail.activity/unlink") {
                // 'unlink' on non-existing record raises a server crash
                throw new Error(
                    "'unlink' RPC on activity must not be called (already unlinked from mark as done)"
                );
            }
        },
    });
    await openFormView("res.partner", partnerId);
    await click(".btn", { text: "Mark Done" });
    await insertText(
        ".o-mail-ActivityMarkAsDone textarea[placeholder='Write Feedback']",
        "This task is done"
    );
    await click(".o-mail-ActivityMarkAsDone button[aria-label='Done']");
    await assertSteps(["action_feedback"]);
});

test("activity mark done popover mark done and schedule next", async (assert) => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    const activityId = pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        res_id: partnerId,
        res_model: "res.partner",
    });
    const { env } = await start({
        async mockRPC(route, args) {
            if (route === "/web/dataset/call_kw/mail.activity/action_feedback_schedule_next") {
                step("action_feedback_schedule_next");
                assert.strictEqual(args.args.length, 1);
                assert.strictEqual(args.args[0].length, 1);
                assert.strictEqual(args.args[0][0], activityId);
                assert.strictEqual(args.kwargs.feedback, "This task is done");
                return false;
            }
            if (route === "/web/dataset/call_kw/mail.activity/unlink") {
                // 'unlink' on non-existing record raises a server crash
                throw new Error(
                    "'unlink' RPC on activity must not be called (already unlinked from mark as done)"
                );
            }
        },
    });
    await openFormView("res.partner", partnerId);
    patchWithCleanup(env.services.action, {
        doAction() {
            step("activity_action");
            throw new Error(
                "The do-action event should not be triggered when the route doesn't return an action"
            );
        },
    });
    await click(".btn", { text: "Mark Done" });
    await insertText(
        ".o-mail-ActivityMarkAsDone textarea[placeholder='Write Feedback']",
        "This task is done"
    );
    await click(".o-mail-ActivityMarkAsDone button[aria-label='Done and Schedule Next']");
    await assertSteps(["action_feedback_schedule_next"]);
});

test("[technical] activity mark done & schedule next with new action", async (assert) => {
    const pyEnv = await startServer();
    const partnerId = pyEnv["res.partner"].create({});
    pyEnv["mail.activity"].create({
        activity_category: "not_upload_file",
        can_write: true,
        res_id: partnerId,
        res_model: "res.partner",
    });
    const { env } = await start({
        async mockRPC(route, args) {
            if (route === "/web/dataset/call_kw/mail.activity/action_feedback_schedule_next") {
                return { type: "ir.actions.act_window" };
            }
        },
    });
    await openFormView("res.partner", partnerId);
    const def = makeDeferred();
    patchWithCleanup(env.services.action, {
        doAction(action) {
            def.resolve();
            step("activity_action");
            assert.deepEqual(
                action,
                { type: "ir.actions.act_window" },
                "The content of the action should be correct"
            );
        },
    });
    await click(".btn", { text: "Mark Done" });
    await click(".o-mail-ActivityMarkAsDone button[aria-label='Done and Schedule Next']");
    await def;
    await assertSteps(["activity_action"]);
});
