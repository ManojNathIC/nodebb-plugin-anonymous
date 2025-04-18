"use strict";

$(document).ready(function () {
  // Add anonymous checkbox to composer
  $(window).on("action:composer.loaded", function (ev, data) {
    const actionBar = $(
      '.composer[data-uuid="' + data.post_uuid + '"] .action-bar'
    );
    const anonymousCheckbox = $(
      '<label class="checkbox" style="margin-right: 10px;"><input type="checkbox" id="anonymous-post"> Post Anonymously</label>'
    );
    actionBar.find(".composer-submit").before(anonymousCheckbox);

    $("#anonymous-post").on("change", function () {
      const isAnonymous = $(this).is(":checked");
      socket.emit("plugins.anonymous.toggleAnonymous", {
        anonymous: isAnonymous,
      });
    });
  });

  // Handle anonymous flag on post submission
  $(window).on("action:composer.submit", function (ev, data) {
    if ($("#anonymous-post").is(":checked")) {
      if (data.composerData) {
        data.composerData.anonymous = true;
      }
      if (data.data) {
        data.data.anonymous = true;
      }
    }
  });

  // Add filter for composer data
  $(window).on("action:composer.push", function (ev, data) {
    if ($("#anonymous-post").is(":checked")) {
      data.anonymous = true;
    }
  });
});
