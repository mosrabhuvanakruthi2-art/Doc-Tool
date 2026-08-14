// Default is a full-screen overlay, for whole-page loads. Pass `inline` when the
// loader sits inside content — a table cell, a modal, a panel — where a fixed
// overlay would escape its container and cover the rest of the page.
function CfLoader({ inline = false }) {
  return (
    <div className={`cf-loader${inline ? ' cf-loader-inline' : ''}`}>
      <div className="cf-loader-ring">
        <img src="/cloudfuze-logo.png" alt="" className="cf-loader-logo" />
      </div>
    </div>
  );
}

export default CfLoader;
