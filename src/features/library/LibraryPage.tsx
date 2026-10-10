import type { Book, ReadingPrefs } from "../../bridge/contracts";
const colors = ["#52675b", "#9f654c", "#536174", "#73674e"];
export function LibraryPage({
  books,
  sort,
  onSort,
  onImport,
  onOpen,
  onRename,
  onRemove,
}: {
  books: Book[];
  sort: ReadingPrefs["sort"];
  onSort: (v: ReadingPrefs["sort"]) => void;
  onImport: () => void;
  onOpen: (b: Book) => void;
  onRename: (b: Book) => void;
  onRemove: (b: Book) => void;
}) {
  const latest = books.find((b) => b.lastReadAt || b.position > 0);
  return (
    <div className="content">
      <div className="welcome">
        <div>
          <div className="eyebrow">YOUR PERSONAL LIBRARY</div>
          <h1>把时间，留给故事。</h1>
          <p className="sub">一本书，一盏灯，一个属于自己的安静角落。</p>
        </div>
        <button className="button primary" onClick={onImport}>
          ＋ 导入 TXT
        </button>
      </div>
      {latest && (
        <div className="continue">
          <div className="mini-cover">
            <b>{latest.title}</b>
            <small>ASTERIN</small>
          </div>
          <div className="continue-info">
            <div className="tiny-label">接着上次的故事</div>
            <h2>{latest.title}</h2>
            <p>
              已读{" "}
              {Math.round(
                (latest.position / Math.max(1, latest.totalUtf16)) * 100,
              )}
              %
            </p>
          </div>
          <button className="button" onClick={() => onOpen(latest)}>
            继续阅读 →
          </button>
        </div>
      )}
      <div className="shelf-heading">
        <h2>
          我的藏书 <small>{books.length} 本</small>
        </h2>
        <select
          className="sort"
          aria-label="书架排序"
          value={sort}
          onChange={(e) => onSort(e.target.value as ReadingPrefs["sort"])}
        >
          <option value="recent">最近阅读</option>
          <option value="title">按书名排序</option>
        </select>
      </div>
      {!books.length ? (
        <div className="empty-library">
          <h2>书架还空着</h2>
          <p>导入一本 TXT，让故事从这里开始。</p>
          <button className="button primary" onClick={onImport}>
            选择小说文件
          </button>
        </div>
      ) : (
        <div className="books">
          {books.map((b, n) => (
            <div key={b.id}>
              <button
                className="book-item"
                aria-label={`阅读${b.title}`}
                onClick={() => onOpen(b)}
              >
                <div
                  className="cover"
                  style={
                    {
                      "--cover": colors[n % 4],
                      "--cover-ink": "#e8ead6",
                    } as React.CSSProperties
                  }
                >
                  <div className="art hills">
                    <span className="moon" />
                    <span className="hill" />
                    <span className="hill second" />
                  </div>
                  <div className="cover-top">
                    <span>ASTERIN</span>
                    <span>藏书</span>
                  </div>
                  <div className="cover-title">{b.title}</div>
                  {b.author && (
                    <div className="cover-author">{b.author} 著</div>
                  )}
                  <div className="cover-bottom">A STORY TO KEEP</div>
                </div>
                <h3>{b.title}</h3>
                <div className="book-meta">
                  <span>{b.chapterCount} 个章节</span>
                  <span>
                    {b.position
                      ? "已读 " +
                        Math.round(
                          (b.position / Math.max(1, b.totalUtf16)) * 100,
                        ) +
                        "%"
                      : "尚未开始"}
                  </span>
                </div>
              </button>
              <div className="book-actions">
                <button onClick={() => onRename(b)}>改名</button>
                <button onClick={() => onRemove(b)}>移除</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="shelf-foot">
        <span>小说副本与阅读记录保存在本机</span>
        <span>慢慢读，故事一直在。</span>
      </div>
    </div>
  );
}
