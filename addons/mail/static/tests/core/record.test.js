/** @odoo-module alias=@mail/../tests/core/record_tests default=false */
const test = QUnit.test; // QUnit.test()

import { BaseStore, Record, makeStore, modelRegistry } from "@mail/core/common/record";

import { registry } from "@web/core/registry";
import { clearRegistryWithCleanup, makeTestEnv } from "@web/../tests/helpers/mock_env";
import { assertSteps, step } from "@web/../tests/utils";
import { markup, reactive, toRaw } from "@odoo/owl";

const serviceRegistry = registry.category("services");

let start;
QUnit.module("record", {
    beforeEach() {
        serviceRegistry.add("store", { start: (env) => makeStore(env) });
        clearRegistryWithCleanup(modelRegistry);
        Record.register();
        ({ Store: class extends BaseStore {} }).Store.register();
        start = async () => {
            const env = await makeTestEnv();
            return env.services.store;
        };
    },
});

test("Insert by passing only single-id value (non-relational)", async (assert) => {
    (class Persona extends Record {
        static id = "name";
        name;
    }).register();
    const store = await start();
    const john = store.Persona.insert("John");
    assert.strictEqual(john.name, "John");
});

test("Can pass object as data for relational field with inverse as id", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        composer = Record.one("Composer", { inverse: "thread" });
    }).register();
    (class Composer extends Record {
        static id = "thread";
        thread = Record.one("Thread");
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    Object.assign(thread, { composer: {} });
    assert.ok(thread.composer);
    assert.ok(thread.composer.thread.eq(thread));
});

test("Assign & Delete on fields with inverses", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        composer = Record.one("Composer", { inverse: "thread" });
        members = Record.many("Member", { inverse: "thread" });
        messages = Record.many("Message", { inverse: "threads" });
    }).register();
    (class Composer extends Record {
        static id = "thread";
        thread = Record.one("Thread");
    }).register();
    (class Member extends Record {
        static id = "name";
        name;
        thread = Record.one("Thread");
    }).register();
    (class Message extends Record {
        static id = "content";
        content;
        threads = Record.many("Thread");
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    const [john, marc] = store.Member.insert(["John", "Marc"]);
    const [hello, world] = store.Message.insert(["hello", "world"]);
    // Assign on fields should adapt inverses
    Object.assign(thread, { composer: {}, members: [["ADD", john]], messages: [hello, world] });
    assert.ok(thread.composer);
    assert.ok(thread.composer.thread.eq(thread));
    assert.ok(john.thread.eq(thread));
    assert.ok(john.in(thread.members));
    assert.ok(hello.in(thread.messages));
    assert.ok(world.in(thread.messages));
    assert.ok(thread.in(hello.threads));
    assert.ok(thread.in(world.threads));
    // add() should adapt inverses
    thread.members.add(marc);
    assert.ok(marc.in(thread.members));
    assert.ok(marc.thread.eq(thread));
    // delete should adapt inverses
    thread.members.delete(john);
    assert.notOk(john.in(thread.members));
    assert.notOk(john.thread);
    // can delete with command
    thread.messages = [["DELETE", world]];
    assert.notOk(world.in(thread.messages));
    assert.notOk(thread.in(world.threads));
    assert.ok(thread.messages.length === 1);
    assert.ok(hello.in(thread.messages));
    assert.ok(thread.in(hello.threads));
    // Deletion removes all relations
    const composer = thread.composer;
    thread.delete();
    assert.notOk(thread.composer);
    assert.notOk(composer.thread);
    assert.notOk(marc.in(thread.members));
    assert.ok(thread.members.length === 0);
    assert.notOk(hello.in(thread.messages));
    assert.notOk(thread.in(hello.threads));
    assert.ok(thread.messages.length === 0);
});

test("onAdd/onDelete hooks on relational with inverse", async (assert) => {
    let logs = [];
    (class Thread extends Record {
        static id = "name";
        name;
        members = Record.many("Member", {
            inverse: "thread",
            onAdd: (member) => logs.push(`Thread.onAdd(${member.name})`),
            onDelete: (member) => logs.push(`Thread.onDelete(${member.name})`),
        });
    }).register();
    (class Member extends Record {
        static id = "name";
        name;
        thread = Record.one("Thread");
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    const [john, marc] = store.Member.insert(["John", "Marc"]);
    thread.members.add(john);
    assert.deepEqual(logs, ["Thread.onAdd(John)"]);
    logs = [];
    thread.members.add(john);
    assert.deepEqual(logs, []);
    marc.thread = thread;
    assert.deepEqual(logs, ["Thread.onAdd(Marc)"]);
    logs = [];
    thread.members.delete(marc);
    assert.deepEqual(logs, ["Thread.onDelete(Marc)"]);
    logs = [];
    thread.members.delete(marc);
    assert.deepEqual(logs, []);
    john.thread = undefined;
    assert.deepEqual(logs, ["Thread.onDelete(John)"]);
});

test("Computed fields", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        type = Record.attr("", {
            compute() {
                if (this.members.length === 0) {
                    return "empty chat";
                } else if (this.members.length === 1) {
                    return "self-chat";
                } else if (this.members.length === 2) {
                    return "dm chat";
                } else {
                    return "group chat";
                }
            },
        });
        admin = Record.one("Persona", {
            compute() {
                return this.members[0];
            },
        });
        members = Record.many("Persona");
    }).register();
    (class Persona extends Record {
        static id = "name";
        name;
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    const [john, marc, antony] = store.Persona.insert(["John", "Marc", "Antony"]);
    Object.assign(thread, { members: [john, marc] });
    assert.ok(thread.admin.eq(john));
    assert.strictEqual(thread.type, "dm chat");
    thread.members.delete(john);
    assert.ok(thread.admin.eq(marc));
    assert.strictEqual(thread.type, "self-chat");
    thread.members.unshift(antony, john);
    assert.ok(thread.admin.eq(antony));
    assert.strictEqual(thread.type, "group chat");
});

test("Computed fields: lazy (default) vs. eager", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        computeType() {
            if (this.members.length === 0) {
                return "empty chat";
            } else if (this.members.length === 1) {
                return "self-chat";
            } else if (this.members.length === 2) {
                return "dm chat";
            } else {
                return "group chat";
            }
        }
        typeLazy = Record.attr("", {
            compute() {
                step("LAZY");
                return this.computeType();
            },
        });
        typeEager = Record.attr("", {
            compute() {
                step("EAGER");
                return this.computeType();
            },
            eager: true,
        });
        members = Record.many("Persona");
    }).register();
    (class Persona extends Record {
        static id = "name";
        name;
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    const members = thread.members;
    await assertSteps(["EAGER"]);
    assert.strictEqual(thread.typeEager, "empty chat");
    await assertSteps([]);
    assert.strictEqual(thread.typeLazy, "empty chat");
    await assertSteps(["LAZY"]);
    members.add("John");
    await assertSteps(["EAGER"]);
    assert.strictEqual(thread.typeEager, "self-chat");
    await assertSteps([]);
    members.add("Antony");
    await assertSteps(["EAGER"]);
    assert.strictEqual(thread.typeEager, "dm chat");
    await assertSteps([]);
    members.add("Demo");
    await assertSteps(["EAGER"]);
    assert.strictEqual(thread.typeEager, "group chat");
    assert.strictEqual(thread.typeLazy, "group chat");
    await assertSteps(["LAZY"]);
});

test("Trusted insert on html field with { html: true }", async (assert) => {
    (class Message extends Record {
        static id = "body";
        body = Record.attr("", { html: true });
    }).register();
    const store = await start();
    const hello = store.Message.insert("<p>hello</p>", { html: true });
    const world = store.Message.insert("<p>world</p>");
    assert.ok(hello.body instanceof markup("").constructor);
    assert.strictEqual(hello.body.toString(), "<p>hello</p>");
    assert.strictEqual(world.body, "<p>world</p>");
});

test("(Un)trusted insertion is applied even with same field value", async (assert) => {
    (class Message extends Record {
        static id = "id";
        id;
        body = Record.attr("", { html: true });
    }).register();
    const store = await start();
    const rawMessage = { id: 1, body: "<p>hello</p>" };
    let message = store.Message.insert(rawMessage);
    assert.notOk(message.body instanceof markup("").constructor);
    message = store.Message.insert(rawMessage, { html: true });
    assert.ok(message.body instanceof markup("").constructor);
    message = store.Message.insert(rawMessage);
    assert.notOk(message.body instanceof markup("").constructor);
});

test("Unshift preserves order", async (assert) => {
    (class Message extends Record {
        static id = "id";
        id;
    }).register();
    (class Thread extends Record {
        static id = "name";
        name;
        messages = Record.many("Message");
    }).register();
    const store = await start();
    const thread = store.Thread.insert({ name: "General" });
    thread.messages.unshift({ id: 3 }, { id: 2 }, { id: 1 });
    assert.deepEqual(
        thread.messages.map((msg) => msg.id),
        [3, 2, 1]
    );
    thread.messages.unshift({ id: 6 }, { id: 5 }, { id: 4 });
    assert.deepEqual(
        thread.messages.map((msg) => msg.id),
        [6, 5, 4, 3, 2, 1]
    );
    thread.messages.unshift({ id: 7 });
    assert.deepEqual(
        thread.messages.map((msg) => msg.id),
        [7, 6, 5, 4, 3, 2, 1]
    );
});

test("onAdd hook should see fully inserted data", async () => {
    (class Thread extends Record {
        static id = "name";
        name;
        members = Record.many("Member", {
            inverse: "thread",
            onAdd: (member) =>
                step(`Thread.onAdd::${member.name}.${member.type}.${member.isAdmin}`),
        });
    }).register();
    (class Member extends Record {
        static id = "name";
        name;
        type;
        isAdmin = Record.attr(false, {
            compute() {
                return this.type === "admin";
            },
        });
        thread = Record.one("Thread");
    }).register();
    const store = await start();
    const thread = store.Thread.insert("General");
    thread.members.add({ name: "John", type: "admin" });
    await assertSteps(["Thread.onAdd::John.admin.true"]);
});

test("Can insert with relation as id, using relation as data object", async (assert) => {
    (class User extends Record {
        static id = "name";
        name;
        settings = Record.one("Settings");
    }).register();
    (class Settings extends Record {
        static id = "user";
        pushNotif;
        user = Record.one("User", { inverse: "settings" });
    }).register();
    const store = await start();
    store.Settings.insert([
        { pushNotif: true, user: { name: "John" } },
        { pushNotif: false, user: { name: "Paul" } },
    ]);
    assert.ok(store.User.get("John"));
    assert.ok(store.User.get("John").settings.pushNotif);
    assert.ok(store.User.get("Paul"));
    assert.notOk(store.User.get("Paul").settings.pushNotif);
});

test("Set on attr should invoke onChange", async () => {
    (class Message extends Record {
        static id = "id";
        id;
        body;
    }).register();
    const store = await start();
    const message = store.Message.insert(1);
    Record.onChange(message, "body", () => step("BODY_CHANGED"));
    await assertSteps([]);
    message.update({ body: "test1" });
    message.body = "test2";
    await assertSteps(["BODY_CHANGED", "BODY_CHANGED"]);
});

test("record list sort should be manually observable", async (assert) => {
    (class Thread extends Record {
        static id = "id";
        id;
        messages = Record.many("Message", { inverse: "thread" });
    }).register();
    (class Message extends Record {
        static id = "id";
        id;
        body;
        author;
        thread = Record.one("Thread", { inverse: "messages" });
    }).register();
    const store = await start();
    const thread = store.Thread.insert(1);
    const messages = store.Message.insert([
        { id: 1, body: "a", thread },
        { id: 2, body: "b", thread },
    ]);
    function sortMessages() {
        // minimal access through observed variables to reduce unexpected observing
        observedMessages.sort((m1, m2) => (m1.body < m2.body ? -1 : 1));
        step(`sortMessages`);
    }
    const observedMessages = reactive(thread.messages, sortMessages);
    assert.equal(`${thread.messages.map((m) => m.id)}`, "1,2");
    sortMessages();
    assert.equal(`${thread.messages.map((m) => m.id)}`, "1,2");
    await assertSteps(["sortMessages"]);
    messages[0].body = "c";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    await assertSteps(["sortMessages", "sortMessages"]);
    messages[0].body = "d";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    await assertSteps(["sortMessages"]);
    messages[0].author = "Jane";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    await assertSteps([]);
    store.Message.insert({ id: 3, body: "c", thread });
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,3,1");
    await assertSteps(["sortMessages", "sortMessages"]);
    messages[0].delete();
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,3");
    await assertSteps(["sortMessages"]);
});

test("relation field sort should be automatically observed", async (assert) => {
    (class Thread extends Record {
        static id = "id";
        id;
        messages = Record.many("Message", {
            inverse: "thread",
            sort: (m1, m2) => (m1.body < m2.body ? -1 : 1),
        });
    }).register();
    (class Message extends Record {
        static id = "id";
        id;
        body;
        author;
        thread = Record.one("Thread", { inverse: "messages" });
    }).register();
    const store = await start();
    const thread = store.Thread.insert(1);
    const messages = store.Message.insert([
        { id: 1, body: "a", thread },
        { id: 2, body: "b", thread },
    ]);
    assert.equal(`${thread.messages.map((m) => m.id)}`, "1,2");
    messages[0].body = "c";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    messages[0].body = "d";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    messages[0].author = "Jane";
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,1");
    store.Message.insert({ id: 3, body: "c", thread });
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,3,1");
    messages[0].delete();
    assert.equal(`${thread.messages.map((m) => m.id)}`, "2,3");
});

test("reading of lazy compute relation field should recompute", async (assert) => {
    (class Thread extends Record {
        static id = "id";
        id;
        messages = Record.many("Message", {
            inverse: "thread",
            sort: (m1, m2) => (m1.body < m2.body ? -1 : 1),
        });
        messages2 = Record.many("Message", {
            compute() {
                return this.messages.map((m) => m.id);
            },
        });
    }).register();
    (class Message extends Record {
        static id = "id";
        id;
        thread = Record.one("Thread", { inverse: "messages" });
    }).register();
    const store = await start();
    const thread = store.Thread.insert(1);
    store.Message.insert([
        { id: 1, thread },
        { id: 2, thread },
    ]);
    const messages2 = thread.messages2;
    assert.strictEqual(`${messages2.map((m) => m.id)}`, "1,2");
    store.Message.insert([{ id: 3, thread }]);
    assert.strictEqual(`${messages2.map((m) => m.id)}`, "1,2,3");
    store.Message.insert([{ id: 4, thread }]);
    assert.strictEqual(`${messages2.map((m) => m.id)}`, "1,2,3,4");
});

test("lazy compute should re-compute while they are observed", async (assert) => {
    (class Channel extends Record {
        static id = "id";
        id;
        count = 0;
        multiplicity = Record.attr(undefined, {
            compute() {
                step("computing");
                if (this.count > 3) {
                    return "many";
                }
                return "few";
            },
        });
    }).register();
    const store = await start();
    const channel = store.Channel.insert(1);
    let observe = true;
    function render() {
        if (observe) {
            step(`render ${reactiveChannel.multiplicity}`);
        }
    }
    const reactiveChannel = reactive(channel, render);
    render();
    await assertSteps(
        ["computing", "render few", "render few"],
        "initial call, render with new value"
    );
    channel.count = 2;
    await assertSteps(["computing"], "changing value to 2 is observed");
    channel.count = 5;
    await assertSteps(["computing", "render many"], "changing value to 5 is observed");
    observe = false;
    channel.count = 6;
    await assertSteps(["computing"], "changing value to 6, still observed until it changes");
    channel.count = 7;
    await assertSteps(["computing"], "changing value to 7, still observed until it changes");
    channel.count = 1;
    await assertSteps(["computing"], "changing value to 1, observed one last time");
    channel.count = 0;
    await assertSteps([], "changing value to 0, no longer observed");
    channel.count = 7;
    await assertSteps([], "changing value to 7, no longer observed");
    channel.count = 1;
    await assertSteps([], "changing value to 1, no longer observed");
    assert.strictEqual(channel.multiplicity, "few");
    await assertSteps(["computing"]);
    observe = true;
    render();
    await assertSteps(["render few"]);
    channel.count = 7;
    await assertSteps(["computing", "render many"]);
});

test("lazy sort should re-sort while they are observed", async (assert) => {
    (class Thread extends Record {
        static id = "id";
        id;
        messages = Record.many("Message", {
            sort: (m1, m2) => m1.sequence - m2.sequence,
        });
    }).register();
    (class Message extends Record {
        static id = "id";
        id;
        sequence;
    }).register();
    const store = await start();
    const thread = store.Thread.insert(1);
    thread.messages.push({ id: 1, sequence: 1 }, { id: 2, sequence: 2 });
    assert.equal(`${thread.messages.map((m) => m.id)}`, "1,2");
    let observe = true;
    function render() {
        if (observe) {
            step(`render ${reactiveChannel.messages.map((m) => m.id)}`);
        }
    }
    const reactiveChannel = reactive(thread, render);
    render();
    const message = thread.messages[0];
    await assertSteps(["render 1,2"]);
    message.sequence = 3;
    await assertSteps(["render 2,1"]);
    message.sequence = 4;
    await assertSteps([]);
    message.sequence = 5;
    await assertSteps([]);
    message.sequence = 1;
    await assertSteps(["render 1,2"]);
    observe = false;
    message.sequence = 10;
    assert.equal(
        `${toRaw(thread)
            ._raw._fields.get("messages")
            .value.data.map((localId) => toRaw(thread)._raw._store.get(localId).id)}`,
        "2,1",
        "observed one last time when it changes"
    );
    await assertSteps([]);
    message.sequence = 1;
    assert.equal(
        `${toRaw(thread)
            ._raw._fields.get("messages")
            .value.data.map((localId) => toRaw(thread)._raw._store.get(localId).id)}`,
        "2,1",
        "no longer observed"
    );
    assert.equal(`${thread.messages.map((m) => m.id)}`, "1,2");
    observe = true;
    render();
    await assertSteps(["render 1,2"]);
    message.sequence = 10;
    await assertSteps(["render 2,1"]);
});

test("store updates can be observed", async () => {
    const store = await start();
    function onUpdate() {
        step(`abc:${reactiveStore.abc}`);
    }
    const rawStore = toRaw(store)._raw;
    const reactiveStore = reactive(store, onUpdate);
    onUpdate();
    await assertSteps(["abc:undefined"]);
    store.abc = 1;
    await assertSteps(["abc:1"], "observable from makeStore");
    rawStore._store.abc = 2;
    await assertSteps(["abc:2"], "observable from record._store");
    rawStore.Model.store.abc = 3;
    await assertSteps(["abc:3"], "observable from Model.store");
});

test("onAdd/onDelete hooks on one without inverse", async () => {
    (class Thread extends Record {
        static id = "name";
    }).register();
    (class Member extends Record {
        static id = "name";
        name;
        thread = Record.one("Thread", {
            onAdd: (thread) => step(`thread.onAdd(${thread.name})`),
            onDelete: (thread) => step(`thread.onDelete(${thread.name})`),
        });
    }).register();
    const store = await start();
    const general = store.Thread.insert("General");
    const john = store.Member.insert("John");
    await assertSteps([]);
    john.thread = general;
    await assertSteps(["thread.onAdd(General)"]);
    john.thread = general;
    await assertSteps([]);
    john.thread = undefined;
    await assertSteps(["thread.onDelete(General)"]);
});

test("onAdd/onDelete hooks on many without inverse", async () => {
    (class Thread extends Record {
        static id = "name";
        name;
        members = Record.many("Member", {
            onAdd: (member) => step(`members.onAdd(${member.name})`),
            onDelete: (member) => step(`members.onDelete(${member.name})`),
        });
    }).register();
    (class Member extends Record {
        static id = "name";
    }).register();
    const store = await start();
    const general = store.Thread.insert("General");
    const jane = store.Member.insert("Jane");
    const john = store.Member.insert("John");
    await assertSteps([]);
    general.members = jane;
    await assertSteps(["members.onAdd(Jane)"]);
    general.members = jane;
    await assertSteps([]);
    general.members = [["ADD", john]];
    await assertSteps(["members.onAdd(John)"]);
    general.members = undefined;
    await assertSteps(["members.onDelete(John)", "members.onDelete(Jane)"]);
});

test("record list assign should update inverse fields", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        members = Record.many("Member", { inverse: "thread" });
    }).register();
    (class Member extends Record {
        static id = "name";
        thread = Record.one("Thread", { inverse: "members" });
    }).register();
    const store = await start();
    const general = store.Thread.insert("General");
    const jane = store.Member.insert("Jane");
    general.members = jane; // direct assignation of value goes through assign()
    assert.ok(jane.thread.eq(general));
    general.members = []; // writing empty array specifically goes through assign()
    assert.notOk(jane.thread);
    jane.thread = general;
    assert.ok(jane.in(general.members));
    jane.thread = [];
    assert.ok(jane.notIn(general.members));
});

test("datetime type record", async (assert) => {
    (class Thread extends Record {
        static id = "name";
        name;
        date = Record.attr(undefined, {
            type: "datetime",
            onUpdate: () => step("DATE_UPDATED"),
        });
    }).register();
    const store = await start();
    await assertSteps([]);
    const general = store.Thread.insert({ name: "General", date: "2024-02-20 14:42:00" });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(general.date instanceof luxon.DateTime);
    assert.ok(general.date.day === 20);
    store.Thread.insert({ name: "General", date: "2024-02-21 14:42:00" });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(general.date.day === 21);
    store.Thread.insert({ name: "General", date: "2024-02-21 14:42:00" });
    await assertSteps([]);
    store.Thread.insert({ name: "General", date: undefined });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(general.date === undefined);
    const now = luxon.DateTime.now();
    const thread = store.Thread.insert({ name: "General", date: now });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(thread.date instanceof luxon.DateTime);
    assert.ok(thread.date.equals(now));
    store.Thread.insert({ name: "General", date: false });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(general.date === false);
    store.Thread.insert({ name: "General", date: "2024-02-22 14:42:00" });
    await assertSteps(["DATE_UPDATED"]);
    assert.ok(general.date.day === 22);
});
