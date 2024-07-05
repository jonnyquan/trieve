import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  useContext,
} from "solid-js";
import {
  type ChunkGroupDTO,
  SingleChunkDTO,
  ChunkBookmarksDTO,
  isChunkGroupPageDTO,
  ChunkMetadata,
  ScoreChunkDTO,
  ChunkMetadataWithScore,
} from "../utils/apiTypes";
import ScoreChunk from "./ScoreChunk";
import { FullScreenModal } from "./Atoms/FullScreenModal";
import { ConfirmModal } from "./Atoms/ConfirmModal";
import ChunkMetadataDisplay from "./ChunkMetadataDisplay";
import { Portal } from "solid-js/web";
import { ChatPopup } from "./ChatPopup";
import { AiOutlineRobot } from "solid-icons/ai";
import { IoDocumentOutline } from "solid-icons/io";
import { DatasetAndUserContext } from "./Contexts/DatasetAndUserContext";

export interface SingleChunkPageProps {
  chunkId: string | undefined;
  defaultResultChunk: SingleChunkDTO;
}
export const SingleChunkPage = (props: SingleChunkPageProps) => {
  const apiHost = import.meta.env.VITE_API_HOST as string;
  const datasetAndUserContext = useContext(DatasetAndUserContext);

  const $dataset = datasetAndUserContext.currentDataset;
  const initialChunkMetadata = props.defaultResultChunk.metadata;

  const [chunkMetadata, setChunkMetadata] = createSignal<ChunkMetadata | null>(
    initialChunkMetadata,
  );
  const [error, setError] = createSignal("");
  const [fetching, setFetching] = createSignal(true);
  const [chunkGroups, setChunkGroups] = createSignal<ChunkGroupDTO[]>([]);
  const $currentUser = datasetAndUserContext.user;
  const [bookmarks, setBookmarks] = createSignal<ChunkBookmarksDTO[]>([]);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] =
    createSignal(false);
  const [totalGroupPages, setTotalGroupPages] = createSignal(0);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const [onDelete, setOnDelete] = createSignal(() => {});
  const [clientSideRequestFinished, setClientSideRequestFinished] =
    createSignal(false);
  const [loadingRecommendations, setLoadingRecommendations] =
    createSignal(false);
  const [recommendedChunks, setRecommendedChunks] = createSignal<
    ChunkMetadataWithScore[]
  >([]);
  const [openChat, setOpenChat] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal<string[]>([]);
  const [scoreChunk, setScoreChunk] = createSignal<ScoreChunkDTO[]>([]);

  if (props.defaultResultChunk.status == 401) {
    setError("You are not authorized to view this chunk.");
  }
  if (props.defaultResultChunk.status == 404) {
    setError(
      "This chunk could not be found. It may be in a different dataset or deleted.",
    );
  }

  // Fetch the chunk groups for the auth'ed user
  const fetchChunkGroups = () => {
    if (!$currentUser?.()) return;
    const currentDataset = $dataset?.();
    if (!currentDataset) return;

    void fetch(`${apiHost}/dataset/groups/${currentDataset.dataset.id}/1`, {
      method: "GET",
      credentials: "include",
      headers: {
        "TR-Dataset": currentDataset.dataset.id,
      },
    }).then((response) => {
      if (response.ok) {
        void response.json().then((data) => {
          if (isChunkGroupPageDTO(data)) {
            setChunkGroups(data.groups);
            setTotalGroupPages(data.total_pages);
          }
        });
      }
    });
  };

  const fetchBookmarks = () => {
    const currentDataset = $dataset?.();
    if (!currentDataset) return;
    void fetch(`${apiHost}/chunk_group/chunks`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "TR-Dataset": currentDataset.dataset.id,
      },
      body: JSON.stringify({
        chunk_ids: chunkMetadata()?.id ? [chunkMetadata()?.id] : [],
      }),
    }).then((response) => {
      if (response.ok) {
        void response.json().then((data) => {
          setBookmarks(data as ChunkBookmarksDTO[]);
        });
      }
    });
  };

  const fetchRecommendations = (
    ids: string[],
    prev_recommendations: ChunkMetadataWithScore[],
  ) => {
    setLoadingRecommendations(true);
    const currentDataset = $dataset?.();
    if (!currentDataset) return;

    void fetch(`${apiHost}/chunk/recommend`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "TR-Dataset": currentDataset.dataset.id,
      },
      body: JSON.stringify({
        positive_chunk_ids: ids,
        limit: prev_recommendations.length + 10,
      }),
    }).then((response) => {
      if (response.ok) {
        void response.json().then((data) => {
          const typed_data = data as ChunkMetadataWithScore[];
          const deduped_data = typed_data.filter((d) => {
            return !prev_recommendations.some((c) => c.id == d.id);
          });
          const new_recommendations = [
            ...prev_recommendations,
            ...deduped_data,
          ];
          setRecommendedChunks(new_recommendations);
        });
      }
      setLoadingRecommendations(false);
    });
  };

  createEffect(() => {
    fetchChunkGroups();
    fetchBookmarks();
  });

  createEffect(() => {
    const currentDataset = $dataset?.();
    if (!currentDataset) return;

    setFetching(true);
    void fetch(`${apiHost}/chunk/${props.chunkId ?? ""}`, {
      method: "GET",
      credentials: "include",
      headers: {
        "TR-Dataset": currentDataset.dataset.id,
      },
    }).then((response) => {
      if (response.ok) {
        void response.json().then((data: ChunkMetadata) => {
          setChunkMetadata(data);
          setScoreChunk([{ metadata: [data], score: 0 }]);
          setError("");
        });
      }
      if (response.status == 404) {
        setError(
          "This chunk could not be found. It may be in a different dataset or deleted.",
        );
      }
      setClientSideRequestFinished(true);
      setFetching(false);
    });
  });

  const getChunk = createMemo(() => {
    if (error().length > 0) {
      return null;
    }
    const curChunkMetadata = chunkMetadata();
    if (!curChunkMetadata) {
      return null;
    }

    return (
      <ScoreChunk
        totalGroupPages={totalGroupPages()}
        chunk={curChunkMetadata}
        score={0}
        chunkGroups={chunkGroups()}
        bookmarks={bookmarks()}
        setOnDelete={setOnDelete}
        setShowConfirmModal={setShowConfirmDeleteModal}
        initialExpanded={true}
        showExpand={clientSideRequestFinished()}
        setChunkGroups={setChunkGroups}
        counter={"0"}
        total={1}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
      />
    );
  });

  return (
    <>
      <Show when={openChat()}>
        <Portal>
          <FullScreenModal isOpen={openChat} setIsOpen={setOpenChat}>
            <Show when={chunkMetadata()}>
              <div class="max-h-[75vh] min-h-[75vh] min-w-[75vw] max-w-[75vw] overflow-y-auto rounded-md scrollbar-thin">
                <ChatPopup
                  chunks={scoreChunk}
                  selectedIds={selectedIds}
                  setOpenChat={setOpenChat}
                />
              </div>
            </Show>
          </FullScreenModal>
        </Portal>
      </Show>
      <div class="mt-2 flex w-full flex-col items-center justify-center">
        <div class="flex w-full max-w-7xl flex-col justify-center px-4 sm:px-8 md:px-20">
          <Show when={error().length > 0 && !fetching()}>
            <div class="flex w-full flex-col items-center rounded-md p-2">
              <div class="text-xl font-bold text-red-500">{error()}</div>
            </div>
          </Show>
          <Show when={!chunkMetadata() && fetching()}>
            <div class="flex w-full flex-col items-center justify-center space-y-4">
              <div class="animate-pulse text-xl">Loading document chunk...</div>
              <div
                class="text-primary inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-current border-magenta border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                role="status"
              >
                <span class="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
                  Loading...
                </span>
              </div>
            </div>
          </Show>
          {getChunk()}
          <Show when={chunkMetadata()}>
            <Show when={recommendedChunks().length > 0}>
              <div class="mx-auto mt-8 w-full max-w-[calc(100%-32px)] min-[360px]:max-w-[calc(100%-64px)]">
                <div class="flex w-full flex-col items-center rounded-md p-2">
                  <div class="text-xl font-semibold">Related Chunks</div>
                </div>

                <For each={recommendedChunks()}>
                  {(chunk) => (
                    <>
                      <div class="mt-4">
                        <ChunkMetadataDisplay
                          totalGroupPages={totalGroupPages()}
                          chunk={chunk}
                          score={chunk.score}
                          chunkGroups={chunkGroups()}
                          bookmarks={bookmarks()}
                          setShowConfirmModal={setShowConfirmDeleteModal}
                          fetchChunkGroups={fetchChunkGroups}
                          setChunkGroups={setChunkGroups}
                          setOnDelete={setOnDelete}
                          showExpand={true}
                        />
                      </div>
                    </>
                  )}
                </For>
              </div>
            </Show>
            <div class="mx-auto mt-8 w-full max-w-[calc(100%-32px)] min-[360px]:max-w-[calc(100%-64px)]">
              <button
                classList={{
                  "w-full rounded  bg-neutral-100 p-2 text-center hover:bg-neutral-100 dark:bg-neutral-700 dark:hover:bg-neutral-800":
                    true,
                  "animate-pulse": loadingRecommendations(),
                }}
                onClick={() =>
                  fetchRecommendations(
                    [chunkMetadata()?.id ?? ""],
                    recommendedChunks(),
                  )
                }
              >
                {recommendedChunks().length == 0 ? "Get" : "Get More"} Related
                Chunks
              </button>
            </div>
          </Show>
        </div>
      </div>
      <div>
        <div
          data-dial-init
          class="group fixed bottom-6 right-6"
          onMouseEnter={() => {
            document
              .getElementById("speed-dial-menu-text-outside-button")
              ?.classList.remove("hidden");
            document
              .getElementById("speed-dial-menu-text-outside-button")
              ?.classList.add("flex");
          }}
          onMouseLeave={() => {
            document
              .getElementById("speed-dial-menu-text-outside-button")
              ?.classList.add("hidden");
            document
              .getElementById("speed-dial-menu-text-outside-button")
              ?.classList.remove("flex");
          }}
        >
          <div
            id="speed-dial-menu-text-outside-button"
            class="mb-4 hidden flex-col items-center space-y-2"
          >
            <button
              type="button"
              class="relative h-[52px] w-[52px] items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-4 focus:ring-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-white dark:focus:ring-gray-400"
              onClick={() => {
                setSelectedIds([chunkMetadata()?.id ?? ""]);
                setOpenChat(true);
              }}
            >
              <IoDocumentOutline class="mx-auto h-7 w-7" />
              <span class="font-sm absolute -left-[8.5rem] top-1/2 mb-px block -translate-y-1/2 break-words text-sm">
                Chat with document
              </span>
            </button>
          </div>
          <button
            type="button"
            class="flex h-14 w-14 items-center justify-center rounded-lg bg-magenta-500 text-white hover:bg-magenta-400 focus:outline-none focus:ring-4 focus:ring-magenta-300 dark:bg-magenta-500 dark:hover:bg-magenta-400 dark:focus:ring-magenta-600"
          >
            <AiOutlineRobot class="h-7 w-7" />
            <span class="sr-only">Open actions menu</span>
          </button>
        </div>
      </div>
      <ConfirmModal
        showConfirmModal={showConfirmDeleteModal}
        setShowConfirmModal={setShowConfirmDeleteModal}
        onConfirm={onDelete}
        message="Are you sure you want to delete this chunk?"
      />
    </>
  );
};
