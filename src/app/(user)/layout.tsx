import Header from "@/components/user/Header";
import Menubar from "@/components/user/Menubar";
import ThemeScripts from "@/components/user/ThemeScripts";
import { currentUser } from "@/lib/user/current";

// Signed-in user panel: includes/header.php + menubar.php + footer.php scripts.
export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <>
      <div id="layout-wrapper">
        <Header name={user.u_name ?? ""} />
        <div id="removeNotificationModal" className="modal fade zoomIn" tabIndex={-1} aria-hidden="true"></div>
        <Menubar userId={user.u_id} enableAi={user.u_enable_ai === 1} />
        {children}
      </div>
      <button className="btn btn-danger btn-icon" id="back-to-top">
        <i className="ri-arrow-up-line"></i>
      </button>
      <ThemeScripts />
    </>
  );
}
