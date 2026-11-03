"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatContact, ChatMessage } from "@/lib/user/chat";

const A = "/common_assets/";

// chat.php + chat_mobile_list.php + chat_message.php (js.php fun_refresh_* / fun_send_message).
export default function ChatApp({ name, initial }: { name: string; initial: ChatContact[] }) {
  const [contacts, setContacts] = useState(initial);
  const [selected, setSelected] = useState(initial[0]?.mobile ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canReply, setCanReply] = useState(false);
  const [text, setText] = useState("");
  const block = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (mb: string) => {
    if (!mb) return;
    const r = await fetch(`/chat_message?mb=${encodeURIComponent(mb)}`);
    if (!r.ok) return;
    const d = (await r.json()) as { messages: ChatMessage[]; canReply: boolean };
    setMessages(d.messages);
    setCanReply(d.canReply);
    requestAnimationFrame(() => block.current && (block.current.scrollTop = block.current.scrollHeight));
  }, []);

  const loadContacts = useCallback(async (smb = "") => {
    const r = await fetch(`/chat_mobile_list?smb=${encodeURIComponent(smb)}`);
    if (r.ok) setContacts(await r.json());
  }, []);

  useEffect(() => {
    loadMessages(selected);
  }, [selected, loadMessages]);

  const send = async () => {
    if (!text.trim()) return alert("Please enter message");
    await fetch("/save_msg", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mb: selected, msg: text }),
    });
    setText("");
    loadMessages(selected);
  };

  return (
    <div className="row" style={{ marginBottom: 30 }}>
      <div className="col-md-4">
        <div className="chat-header">
          <div className="user-img"></div>
          <div className="nav-icons">
            <li>{name}</li>
          </div>
        </div>
        <div className="search-container">
          <div className="input">
            <input type="text" placeholder="Search or start new chat   " name="smb" id="smb" onKeyUp={(e) => loadContacts(e.currentTarget.value)} />
          </div>
        </div>
        <div className="chat-list" id="chatlist">
          {contacts.map((c) => (
            <div
              key={c.mobile}
              className={`chat-box ${selected === c.mobile ? "active" : ""}`}
              onClick={() => {
                setSelected(c.mobile);
                loadContacts();
              }}
            >
              <div className="img-box">
                <img className="img-cover" src={`${A}images/user-no-img.jpg`} alt="" />
              </div>
              <div className="chat-details">
                <div className="text-head">
                  <h4 style={{ width: "70%", overflow: "hidden" }}>
                    <span className="customer-name mb-2" style={{ clear: "both" }}>{c.name}</span>
                    <span style={{ display: "block" }} className="mt-1">{c.mobile}</span>
                  </h4>
                  <h4 style={{ width: "30%", overflow: "hidden" }}>
                    {c.unread > 0 && selected !== c.mobile && <b style={{ clear: "both", width: 20 }}>{c.unread}</b>}
                    <p className="time mt-1" style={{ display: "block" }}>{c.last}</p>
                  </h4>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-md-8 chat-message" id="chat_message">
        <div className="header">
          <div className="img-text">
            <div className="user-img">
              <img className="dp" src={`${A}images/user-no-img.jpg`} alt="" />
            </div>
            <h4>
              {selected}
              <br />
              <span></span>
            </h4>
          </div>
        </div>
        <div className="chat-container" id="chat_block" ref={block}>
          {messages.map((m) => (
            <div key={m.id} className={`message-box ${m.mine ? "my-message" : "friend-message"}`}>
              <p>
                <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                <br />
                <span>
                  {m.mine && (
                    <i
                      className={m.tick === "sent" ? " las la-check " : " las la-check-double "}
                      style={{ marginRight: 5, fontSize: 15, color: m.tick === "read" ? "blue" : "grey" }}
                    ></i>
                  )}
                  {m.time}
                </span>
              </p>
            </div>
          ))}
        </div>
        <div className="chatbox-input">
          {selected && canReply ? (
            <>
              <input type="text" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()} />
              <div className="links-list-item">
                <button type="button" className="btn btn-success chat-send waves-effect waves-light fs-13" onClick={send}>
                  <i className="ri-send-plane-2-fill align-bottom"></i>
                </button>
              </div>
            </>
          ) : selected ? (
            <a className="btn btn-success chat-send waves-effect waves-light fs-13" style={{ marginLeft: 20 }}
              href={`/compose?mb=${encodeURIComponent(selected)}&s=false`}>
              Send Template
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
