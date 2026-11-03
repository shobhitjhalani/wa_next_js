(function() {
    
tinymce.init({
  selector: "textarea.text-editor",
  menubar: false,
  toolbar: false,          // 🚀 disables toolbar
  plugins: [],             // optional: disable all plugins too
  statusbar: false,        // optional: hide bottom status bar
  branding: false          // optional: hide "Powered by TinyMCE"
});
})();