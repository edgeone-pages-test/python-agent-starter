import type React from 'react';
import styles from './CodeViewer.module.css';

/* ── Token factory ── */
const token = (cls: string) =>
  function Token({ t }: { t: string }) { return <span className={cls}>{t}</span>; };

const Cmt = token(styles.cmt);
const Dec = token(styles.dec);
const Kw  = token(styles.kw);
const Fn  = token(styles.fn);
const Ty  = token(styles.ty);
const Str = token(styles.str);
const Op  = token(styles.op);
const Va  = token(styles.va);

interface LineProps { n: number; children?: React.ReactNode }
const L = ({ n, children }: LineProps) => (
  <div className={styles.line}>
    <span className={styles.ln}>{String(n).padStart(2, ' ')}</span>
    <span className={styles.lc}>{children ?? ' '}</span>
  </div>
);

/** Indentation helper — renders `level` indents */
const I = ({ level = 1 }: { level?: number }) => (
  <>{Array.from({ length: level }, (_, i) => <span key={i} className={styles.indent} />)}</>
);

export default function CodeViewer() {
  return (
    <div className={styles.panel}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.fileIcon}>⬡</span>
          <span className={styles.filename}>main.py</span>
        </div>
        <span className={styles.badge}>READ ONLY</span>
      </div>

      {/* ── Code body ── */}
      <div className={styles.body}>
        {/* CRT scanline overlay */}
        <div className={styles.scanline} aria-hidden />

        <div className={styles.code}>
          {/* ── Imports ── */}
          <L n={1}><Kw t="import " /><Va t="httpx" /></L>
          <L n={2}><Kw t="from " /><Va t="agents._model" /><Kw t=" import " /><Ty t="MODEL_CONFIG" /></L>
          <L n={3}><Kw t="from " /><Va t="agents._session" /><Kw t=" import " /><Ty t="ChatSession" /></L>
          <L n={4}><Kw t="from " /><Va t="agents._tools" /><Kw t=" import " /><Ty t="build_tools" /></L>
          <L n={5} />
          <L n={6}><Va t="SYSTEM_PROMPT" /><Op t=" = " /><Str t='"..."' /></L>
          <L n={7} />

          {/* ── handler function ── */}
          <L n={8}>
            <Dec t="async " /><Kw t="def " /><Fn t="handler" /><Op t="(" /><Va t="context" /><Op t="):" />
          </L>
          <L n={9}>
            <I /><Va t="message" /><Op t=" = " /><Va t="context" /><Op t="." /><Va t="request" /><Op t="." /><Va t="body" /><Op t="." /><Fn t="get" /><Op t="(" /><Str t='"message"' /><Op t=", " /><Str t='""' /><Op t=")" />
          </L>
          <L n={10}>
            <I /><Va t="conversation_id" /><Op t=" = " /><Va t="context" /><Op t="." /><Va t="conversation_id" />
          </L>
          <L n={11}>
            <I /><Va t="store" /><Op t=" = " /><Va t="context" /><Op t="." /><Va t="store" />
          </L>
          <L n={12} />

          {/* ── 1. EdgeOne Store ── */}
          <L n={13}>
            <I /><Cmt t="# 1. EdgeOne Store: load history + save user message" />
          </L>
          <L n={14}>
            <I /><Va t="session" /><Op t=" = " /><Ty t="ChatSession" /><Op t="(" /><Va t="store" /><Op t=")" />
          </L>
          <L n={15}>
            <I /><Va t="history" /><Op t=" = " /><Dec t="await " /><Va t="session" /><Op t="." /><Fn t="get_history" /><Op t="(" /><Va t="conversation_id" /><Op t=")" />
          </L>
          <L n={16}>
            <I /><Dec t="await " /><Va t="session" /><Op t="." /><Fn t="save_user_message" /><Op t="(" /><Va t="conversation_id" /><Op t=", " /><Va t="message" /><Op t=")" />
          </L>
          <L n={17} />

          {/* ── messages array ── */}
          <L n={18}>
            <I /><Va t="messages" /><Op t=" = [" />
          </L>
          <L n={19}>
            <I level={2} /><Op t='{' /><Str t='"role"' /><Op t=": " /><Str t='"system"' /><Op t=", " /><Str t='"content"' /><Op t=": " /><Va t="SYSTEM_PROMPT" /><Op t="}," />
          </L>
          <L n={20}>
            <I level={2} /><Op t="*" /><Va t="history" /><Op t="," />
          </L>
          <L n={21}>
            <I level={2} /><Op t='{' /><Str t='"role"' /><Op t=": " /><Str t='"user"' /><Op t=", " /><Str t='"content"' /><Op t=": " /><Va t="message" /><Op t="}," />
          </L>
          <L n={22}>
            <I /><Op t="]" />
          </L>
          <L n={23} />

          {/* ── 2. EdgeOne Tools ── */}
          <L n={24}>
            <I /><Cmt t="# 2. EdgeOne Tools -> function calling schema" />
          </L>
          <L n={25}>
            <I /><Va t="tool_registry" /><Op t=" = " /><Fn t="build_tools" /><Op t="(" /><Va t="context" /><Op t=")" />
          </L>
          <L n={26} />
          <L n={27}>
            <I /><Va t="payload" /><Op t=" = {" /><Str t='"model"' /><Op t=": " /><Va t="MODEL_CONFIG" /><Op t='["model"], ' /><Str t='"messages"' /><Op t=": " /><Va t="messages" /><Op t="}" />
          </L>
          <L n={28}>
            <I /><Kw t="if " /><Va t="tool_registry" /><Op t="." /><Fn t="has_tools" /><Op t="():" />
          </L>
          <L n={29}>
            <I level={2} /><Va t="payload" /><Op t='["tools"] = ' /><Va t="tool_registry" /><Op t="." /><Va t="tools" />
          </L>
          <L n={30}>
            <I level={2} /><Va t="payload" /><Op t='["tool_choice"] = ' /><Str t='"auto"' />
          </L>
          <L n={31} />

          {/* ── 3. httpx call ── */}
          <L n={32}>
            <I /><Cmt t="# 3. httpx call to OpenAI-compatible API" />
          </L>
          <L n={33}>
            <I /><Dec t="async " /><Kw t="with " /><Va t="httpx" /><Op t="." /><Ty t="AsyncClient" /><Op t="(" /><Va t="timeout" /><Op t="=" /><Va t="300" /><Op t=") " /><Kw t="as " /><Va t="client" /><Op t=":" />
          </L>
          <L n={34}>
            <I level={2} /><Va t="resp" /><Op t=" = " /><Dec t="await " /><Va t="client" /><Op t="." /><Fn t="post" /><Op t="(" />
          </L>
          <L n={35}>
            <I level={3} /><Str t={'f"{MODEL_CONFIG[\'base_url\']}/chat/completions"'} /><Op t="," />
          </L>
          <L n={36}>
            <I level={3} /><Va t="headers" /><Op t="={" /><Str t='"Authorization"' /><Op t=": " /><Str t={'f"Bearer {MODEL_CONFIG[\'api_key\']}"'} /><Op t="}," />
          </L>
          <L n={37}>
            <I level={3} /><Va t="json" /><Op t="=" /><Va t="payload" /><Op t="," />
          </L>
          <L n={38}>
            <I level={2} /><Op t=")" />
          </L>
          <L n={39} />

          {/* ── 4. Tool calling ── */}
          <L n={40}>
            <I /><Cmt t="# 4. Tool calling: model returns tool_calls -> execute sandbox tools" />
          </L>
          <L n={41}>
            <I /><Va t="assistant_msg" /><Op t=" = " /><Va t="resp" /><Op t="." /><Fn t="json" /><Op t='()["choices"][0]["message"]' />
          </L>
          <L n={42} />
          <L n={43}>
            <I /><Kw t="if " /><Va t="assistant_msg" /><Op t="." /><Fn t="get" /><Op t="(" /><Str t='"tool_calls"' /><Op t="):" />
          </L>
          <L n={44}>
            <I level={2} /><Kw t="for " /><Va t="tc" /><Kw t=" in " /><Va t="assistant_msg" /><Op t='["tool_calls"]:' />
          </L>
          <L n={45}>
            <I level={3} /><Va t="name" /><Op t=" = " /><Va t="tc" /><Op t='["function"]["name"]' />
          </L>
          <L n={46}>
            <I level={3} /><Va t="args" /><Op t=" = " /><Va t="tc" /><Op t='["function"]["arguments"]' />
          </L>
          <L n={47}>
            <I level={3} /><Cmt t="# Execute EdgeOne sandbox tool" />
          </L>
          <L n={48}>
            <I level={3} /><Va t="tool_result" /><Op t=" = " /><Dec t="await " /><Va t="tool_registry" /><Op t="." /><Fn t="execute" /><Op t="(" /><Va t="name" /><Op t=", " /><Va t="args" /><Op t=")" />
          </L>
          <L n={49}>
            <I level={3} /><Va t="messages" /><Op t="." /><Fn t="append" /><Op t="({" /><Str t='"role"' /><Op t=": " /><Str t='"tool"' /><Op t=", ...})" />
          </L>
          <L n={50}>
            <I level={2} /><Va t="assistant_text" /><Op t=" = " /><Dec t="await " /><Fn t="continue_with_tools" /><Op t="(" /><Va t="messages" /><Op t=")" />
          </L>
          <L n={51}>
            <I /><Kw t="else" /><Op t=":" />
          </L>
          <L n={52}>
            <I level={2} /><Va t="assistant_text" /><Op t=" = " /><Va t="assistant_msg" /><Op t="." /><Fn t="get" /><Op t="(" /><Str t='"content"' /><Op t=", " /><Str t='""' /><Op t=")" />
          </L>
          <L n={53} />

          {/* ── 5. Save & return ── */}
          <L n={54}>
            <I /><Cmt t="# 5. EdgeOne Store: save assistant reply for /history restore" />
          </L>
          <L n={55}>
            <I /><Dec t="await " /><Va t="session" /><Op t="." /><Fn t="save_assistant_message" /><Op t="(" /><Va t="conversation_id" /><Op t=", " /><Va t="assistant_text" /><Op t=")" />
          </L>
          <L n={56}>
            <I /><Kw t="return " /><Op t="{" /><Str t='"answer"' /><Op t=": " /><Va t="assistant_text" /><Op t="}" />
          </L>
        </div>
      </div>

      {/* ── Footer tag ── */}
      <div className={styles.footer}>
        <span className={styles.footerDot} />
        <span>Python Starter · EdgeOne Agent</span>
      </div>
    </div>
  );
}
