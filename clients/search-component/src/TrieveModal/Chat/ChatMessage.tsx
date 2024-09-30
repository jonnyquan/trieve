import * as React from "react";
import { AIIcon, LoadingIcon, UserIcon } from "../icons";
import Markdown from "react-markdown";
import SyntaxHighlighter from "react-syntax-highlighter";
import { nightOwl } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { Chunk } from "../../utils/types";
import { useModalState } from "../../utils/hooks/modal-context";

type Message = {
  type: string;
  text: string;
  additional: Chunk[] | null;
};

export const ChatMessage = ({
  message,
  idx,
}: {
  message: Message;
  idx: number;
}) => {
  const { props } = useModalState();
  return (
    <>
      {message.type == "user" ? (
        <>
          <span className="ai-avatar user">
            <UserIcon />
            <p
              className="tag"
              // style mostly transparent brand color
              style={{
                backgroundColor: props.brandColor
                  ? `${props.brandColor}18`
                  : "#CB53EB18",
                color: props.brandColor ?? "#CB53EB",
              }}
            >
              User
            </p>
          </span>
          <div className={message.type}>
            <span> {message.text}</span>
          </div>
        </>
      ) : (
        <>
          <span className="ai-avatar assistant">
            {props.brandLogoImgSrcUrl ? (
              <img
                src={props.brandLogoImgSrcUrl}
                alt={props.brandName || "Brand logo"}
              />
            ) : (
              <AIIcon />
            )}
            <p
              className="tag"
              // style mostly transparent brand color
              style={{
                backgroundColor: props.brandColor
                  ? `${props.brandColor}18`
                  : "#CB53EB18",
                color: props.brandColor ?? "#CB53EB",
              }}
            >
              AI assistant
            </p>
          </span>
          <Message key={idx} message={message} idx={idx} />
        </>
      )}
    </>
  );
};

export const Message = ({
  message,
  idx,
}: {
  idx: number;
  message: Message;
}) => {
  return (
    <div>
      {message.text == "Loading..." ? (
        <div className="system">
          <LoadingIcon className="loading" />
        </div>
      ) : null}
      {message.type === "system" && message.text != "Loading..." ? (
        <div className="system">
          <Markdown
            components={{
              code: (props) => {
                const { className, children } = props || {};
                if (!children) return null;
                if (!className) {
                  return (
                    <SyntaxHighlighter language={"bash"} style={nightOwl}>
                      {children?.toString()}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <SyntaxHighlighter
                    language={className?.split("language")[1] || "bash"}
                    style={nightOwl}
                  >
                    {children?.toString()}
                  </SyntaxHighlighter>
                );
              },
            }}
            key={idx}
          >
            {message.text}
          </Markdown>
          {message.additional ? (
            <div className="additional-links">
              {message.additional
                .filter(
                  (m) =>
                    (m.metadata.heading ||
                      m.metadata.title ||
                      m.metadata.page_title) &&
                    m.link
                )
                .map((m) => [
                  m.metadata.heading ||
                    m.metadata.title ||
                    m.metadata.page_title,
                  m.link,
                ])
                .filter(
                  (v, i, a) => a.findIndex((t) => t[0] === v[0]) === i && v[0]
                )
                .map((link) => (
                  <a key={link[1]} href={link[1] as string} target="_blank">
                    {link[0]}
                  </a>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};