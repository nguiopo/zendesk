import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPresence, TeamChatMessage } from '../types/helpdesk';

interface TicketActivityBanner {
  id: string;
  ticketRef: string;
  agentName: string;
  actionLabel: string;
  timestamp: string;
}

export function useCollaborationSocket(agentName: string, agentEmail: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>(`c_${Math.random().toString(36).slice(2, 10)}`);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<AgentPresence[]>([]);
  const [chatMessages, setChatMessages] = useState<TeamChatMessage[]>([]);
  const [recentActivity, setRecentActivity] = useState<TicketActivityBanner[]>([]);

  useEffect(() => {
    if (!agentName) return;

    let active = true;
    let reconnectTimer: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!active) return;
        setConnected(true);
        socket.send(
          JSON.stringify({
            type: 'presence:update',
            clientId: clientIdRef.current,
            agentName,
            agentEmail,
            status: 'online',
            activeTicketId: null,
            typingTicketId: null,
          })
        );
      };

      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'init') {
            if (Array.isArray(payload.presence)) setPresence(payload.presence);
            if (Array.isArray(payload.chatHistory)) setChatMessages(payload.chatHistory);
          } else if (payload.type === 'presence:sync') {
            if (Array.isArray(payload.presence)) setPresence(payload.presence);
          } else if (payload.type === 'chat:message' && payload.message) {
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === payload.message.id)) return prev;
              return [...prev, payload.message].slice(-100);
            });
          } else if (payload.type === 'ticket:activity') {
            setRecentActivity((prev) => [
              {
                id: `${Date.now()}-${Math.random()}`,
                ticketRef: payload.ticketRef || '',
                agentName: payload.agentName || 'Un agent',
                actionLabel: payload.actionLabel || 'a mis à jour un ticket',
                timestamp: payload.timestamp || new Date().toISOString(),
              },
              ...prev.slice(0, 4),
            ]);
          }
        } catch {
          // Ignore invalid payloads
        }
      };

      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer = window.setTimeout(connect, 2500);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [agentName, agentEmail]);

  const updatePresence = useCallback(
    (patch: { activeTicketId?: string | null; typingTicketId?: string | null; status?: 'online' | 'in_call' | 'on_call' }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'presence:update',
            clientId: clientIdRef.current,
            agentName,
            agentEmail,
            ...patch,
          })
        );
      }
    },
    [agentName, agentEmail]
  );

  const sendChatMessage = useCallback(
    (body: string, authorRole = 'Support', ticketRef?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && body.trim()) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:send',
            authorName: agentName,
            authorRole,
            ticketRef,
            body: body.trim(),
          })
        );
      }
    },
    [agentName]
  );

  const broadcastTicketActivity = useCallback(
    (ticketId: string, ticketRef: string, actionLabel: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'ticket:activity',
            ticketId,
            ticketRef,
            agentName,
            actionLabel,
          })
        );
      }
    },
    [agentName]
  );

  return {
    connected,
    presence,
    chatMessages,
    recentActivity,
    updatePresence,
    sendChatMessage,
    broadcastTicketActivity,
  };
}
