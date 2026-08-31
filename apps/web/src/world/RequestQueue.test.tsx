import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RequestQueue } from "./RequestQueue";
import { grantedRoomsFor, resetCapabilities } from "./decision";
import { resetEvents } from "./eventLog";
import { pendingRequests, queueRequest, resetRequests, wasDenied } from "./requests";
import { FILE_ROOMS } from "./resources";

const room = FILE_ROOMS.find((candidate) => candidate.ownerId === "user-a")!;

function queueOne() {
  return queueRequest({
    agentId: "agent-1",
    agentName: "Scout",
    roomId: room.id,
    roomOwnerId: room.ownerId!,
  })!;
}

describe("RequestQueue", () => {
  beforeEach(() => {
    resetCapabilities();
    resetRequests();
    resetEvents();
  });

  afterEach(cleanup);

  it("tells a signed-out viewer where to sign in rather than showing an empty queue", () => {
    queueOne();
    render(<RequestQueue ownerId={null} ownerName="Owner" />);
    expect(screen.getByText(/Sign in to the world/)).toBeTruthy();
  });

  it("lists only requests against the viewer's own rooms", () => {
    queueOne();
    queueRequest({
      agentId: "agent-2",
      agentName: "Intruder",
      roomId: FILE_ROOMS.find((candidate) => candidate.ownerId === "user-b")!.id,
      roomOwnerId: "user-b",
    });

    render(<RequestQueue ownerId="user-a" ownerName="User A" />);

    expect(screen.getByText(/Scout/)).toBeTruthy();
    expect(screen.queryByText(/Intruder/)).toBeNull();
  });

  it("takes two clicks to grant, and issues the keycard only on the second", () => {
    queueOne();
    render(<RequestQueue ownerId="user-a" ownerName="User A" />);

    fireEvent.click(screen.getByText("Grant"));
    // Armed, not committed: no capability yet.
    expect(grantedRoomsFor("agent-1")).toHaveLength(0);
    expect(screen.getByText(new RegExp(`keycard for ${room.displayName}`))).toBeTruthy();

    fireEvent.click(screen.getByText("Confirm grant"));
    expect(grantedRoomsFor("agent-1")).toContain(room.id);
    expect(pendingRequests()).toHaveLength(0);
    expect(screen.getByText(/granted Scout access to/)).toBeTruthy();
  });

  it("cancels an armed decision without granting anything", () => {
    queueOne();
    render(<RequestQueue ownerId="user-a" ownerName="User A" />);

    fireEvent.click(screen.getByText("Grant"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(grantedRoomsFor("agent-1")).toHaveLength(0);
    expect(pendingRequests()).toHaveLength(1);
    expect(screen.getByText("Grant")).toBeTruthy();
  });

  it("denying clears the request, marks the pair denied, and logs it", () => {
    queueOne();
    render(<RequestQueue ownerId="user-a" ownerName="User A" />);

    fireEvent.click(screen.getByText("Deny"));
    fireEvent.click(screen.getByText("Confirm deny"));

    expect(grantedRoomsFor("agent-1")).toHaveLength(0);
    expect(pendingRequests()).toHaveLength(0);
    expect(wasDenied("agent-1", room.id)).toBe(true);
    expect(screen.getByText(/denied Scout access to/)).toBeTruthy();
  });

  it("picks up a request raised after it rendered", () => {
    render(<RequestQueue ownerId="user-a" ownerName="User A" />);
    expect(screen.getByText(/No agent is waiting on you/)).toBeTruthy();

    // The store is mutated from outside React (the world sim raises it), so the
    // notification has to be flushed for the subscription to re-render.
    act(() => {
      queueOne();
    });

    expect(screen.getByText(/Scout/)).toBeTruthy();
  });
});
