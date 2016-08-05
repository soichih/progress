define({ "api": [
  {
    "type": "get",
    "url": "/:key",
    "title": "Get Progress detail",
    "group": "Status",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "depth",
            "description": "<p>How deep you want to traverse the progress tree. Default to 1</p>"
          }
        ]
      }
    },
    "description": "<p>Returns all tasks that belongs to a user. This is currently a public interface</p>",
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\"_total_weight\":\"0\",\"_total_progress\":\"0\",\"msg\":\"doing 0.5098086714278907\",\"key\":\"_test.100\",\"weight\":1,\"start_time\":1454074695846,\"update_time\":1454074834012,\"tasks\":[{\"_total_weight\":\"0\",\"_total_progress\":\"0.22608440299518406\",\"msg\":\"doing 0.5098086714278907\",\"key\":\"_test.100.1\",\"weight\":1,\"start_time\":1454074695843,\"update_time\":1454074834011}]}",
          "type": "json"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "api/controllers.js",
    "groupTitle": "Status",
    "name": "GetKey"
  }
] });